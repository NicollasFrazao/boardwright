import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  formatMarker,
  parseMarker,
  tick,
} from '../src/index.ts';
import {
  baseConfig,
  ISSUE,
  keyOf,
  scenario,
} from './fakes.ts';

const HOUR = 3_600_000;

function events(bodies: string[]): string[] {
  return bodies.map((body) => {
    const marker = parseMarker(body);

    return marker === undefined ? 'text' : `${marker.event}#${marker.attempt}`;
  });
}

describe('tick: the happy path', () => {
  it('claims, runs, records the outcome and moves the card to In review', async () => {
    const world = scenario();
    const report = await tick(world.dependencies);

    expect(report.entries).toHaveLength(1);

    expect(report.entries[0]?.action).toEqual({
      kind: 'run',
      attempt: 1,
    });

    expect(report.entries[0]?.result).toMatchObject({
      kind: 'completed',
      outcome: { event: 'succeeded' },
    });

    expect(events(world.repoHost.bodies(ISSUE))).toEqual([
      'started#1',
      'succeeded#1',
    ]);

    expect(world.board.moves.map((move) => move.status)).toEqual([
      'In Progress',
      'In review',
    ]);
  });

  it('leaves the item alone on the next tick: it is no longer in Ready', async () => {
    const world = scenario();

    await tick(world.dependencies);

    const second = await tick(world.dependencies);

    expect(second.entries).toHaveLength(0);
    expect(world.workspaces.prepared).toHaveLength(1);
  });
});

describe('tick: who may start an agent', () => {
  it('skips a repository outside the allowlist without reading it', async () => {
    const world = scenario(baseConfig({ repositories: ['acme/other'] }));
    const report = await tick(world.dependencies);

    expect(report.entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'repository-not-allowed',
    });

    expect(world.agent.requests).toHaveLength(0);
  });

  it('skips an issue without the trigger label', async () => {
    const world = scenario();

    world.repoHost.issues.set(
      keyOf(ISSUE),
      {
        ...(await world.repoHost.getIssue(ISSUE)),
        labels: ['enhancement'],
      },
    );

    const report = await tick(world.dependencies);

    expect(report.entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'not-triggered',
    });
  });

  it('skips a closed issue', async () => {
    const world = scenario();

    world.repoHost.issues.set(
      keyOf(ISSUE),
      {
        ...(await world.repoHost.getIssue(ISSUE)),
        isOpen: false,
      },
    );

    expect((await tick(world.dependencies)).entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'issue-closed',
    });
  });

  it.each([
    [
      'labelled by someone with read access',
      'read',
    ],
    [
      'whose labeller is unknown',
      undefined,
    ],
  ] as const)('never runs an issue %s', async (
    _case,
    permission,
  ) => {
    const world = scenario();

    if (permission === undefined) {
      world.repoHost.labelActors.delete(keyOf(ISSUE));
    } else {
      world.repoHost.labelActors.set(
        keyOf(ISSUE),
        {
          login: 'stranger',
          permission,
        },
      );
    }

    const report = await tick(world.dependencies);

    expect(report.entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'trigger-without-triage',
    });

    expect(world.repoHost.bodies(ISSUE)).toEqual([]);
    expect(world.agent.requests).toHaveLength(0);
  });

  it('does not ask who labelled the issue when triage is not required', async () => {
    const world = scenario(baseConfig({ trigger: { requireTriage: false } }));

    world.repoHost.labelActors.delete(keyOf(ISSUE));

    expect((await tick(world.dependencies)).entries[0]?.action.kind).toBe('run');
  });
});

describe('tick: idempotency and concurrency', () => {
  it('writes nothing in a dry run', async () => {
    const world = scenario();

    const report = await tick(
      world.dependencies,
      { dryRun: true },
    );

    expect(report.entries[0]).toMatchObject({
      action: {
        kind: 'run',
        attempt: 1,
      },
      result: undefined,
    });

    expect(world.repoHost.bodies(ISSUE)).toEqual([]);
    expect(world.board.moves).toEqual([]);
    expect(world.agent.requests).toHaveLength(0);
  });

  it('backs off when another runner claimed the same attempt first', async () => {
    const world = scenario();

    world.repoHost.afterComment = (
      ref,
      body,
    ) => {
      if (parseMarker(body)?.event === 'started') {
        world.repoHost.afterComment = undefined;

        world.repoHost.store(
          ref,
          formatMarker({
            stage: 'implement',
            runId: 'other-runner',
            attempt: 1,
            event: 'started',
          }),
          new Date(world.clock.now().getTime() - 1),
        );
      }
    };

    const report = await tick(world.dependencies);

    expect(report.entries[0]?.result).toEqual({ kind: 'lost-claim' });
    expect(world.board.moves).toEqual([]);
    expect(world.agent.requests).toHaveLength(0);
  });

  it('waits for a run another runner has in flight', async () => {
    const world = scenario();

    world.repoHost.store(
      ISSUE,
      formatMarker({
        stage: 'implement',
        runId: 'other-runner',
        attempt: 1,
        event: 'started',
      }),
    );

    world.clock.advance(HOUR / 2);

    expect((await tick(world.dependencies)).entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'in-flight',
    });
  });

  it('starts at most `concurrency` runs per tick and defers the rest', async () => {
    const world = scenario();

    const second = {
      repository: 'acme/app',
      number: 8,
    };

    world.board.items.push({
      itemId: 'item-8',
      status: 'Ready',
      issue: second,
    });

    world.repoHost.issues.set(
      keyOf(second),
      {
        ...(await world.repoHost.getIssue(ISSUE)),
        ref: second,
      },
    );

    world.repoHost.labelActors.set(
      keyOf(second),
      {
        login: 'maintainer',
        permission: 'write',
      },
    );

    const report = await tick(world.dependencies);

    expect(report.entries.map((entry) => entry.action.kind)).toEqual([
      'run',
      'deferred',
    ]);

    expect(world.board.statusOf('item-8')).toBe('Ready');
  });

  it('moves the card forward again when a succeeded run left it behind', async () => {
    const world = scenario();

    world.repoHost.store(
      ISSUE,
      formatMarker({
        stage: 'implement',
        runId: 'run-0',
        attempt: 1,
        event: 'started',
      }),
    );

    world.repoHost.store(
      ISSUE,
      formatMarker({
        stage: 'implement',
        runId: 'run-0',
        attempt: 1,
        event: 'succeeded',
      }),
    );

    world.repoHost.openPullRequests.set(
      'acme/app:agent/issue-7',
      {
        number: 9,
        url: 'https://github.com/acme/app/pull/9',
      },
    );

    const report = await tick(world.dependencies);

    expect(report.entries[0]).toMatchObject({
      action: {
        kind: 'repair-status',
        status: 'In review',
      },
      result: { kind: 'applied' },
    });

    expect(world.agent.requests).toHaveLength(0);
  });
});

describe('tick: failures', () => {
  it('sends a failed run back to Ready, and the next tick tries attempt 2', async () => {
    const world = scenario();

    world.workspaces.changed = [];
    await tick(world.dependencies);

    expect(world.board.statusOf('item-7')).toBe('Ready');

    world.workspaces.changed = ['src/feature.ts'];
    world.clock.advance(1000);

    const second = await tick(world.dependencies);

    expect(second.entries[0]?.action).toEqual({
      kind: 'run',
      attempt: 2,
    });

    expect(world.board.statusOf('item-7')).toBe('In review');
  });

  it('sends a denied run to a person', async () => {
    const world = scenario();

    world.workspaces.changed = ['.github/workflows/ci.yml'];
    await tick(world.dependencies);

    expect(world.board.statusOf('item-7')).toBe('Todo');
    expect(world.repoHost.bodies(ISSUE).at(-1)).toContain('denied paths: .github/workflows/ci.yml');
  });

  it('records a crashed agent session as a failed attempt', async () => {
    const world = scenario();

    world.agent.error = new Error('session crashed');

    const report = await tick(world.dependencies);

    expect(report.entries[0]?.result).toMatchObject({
      kind: 'completed',
      outcome: {
        event: 'failed',
        detail: 'The run stopped with an error: session crashed',
      },
    });

    expect(world.board.statusOf('item-7')).toBe('Ready');
  });

  it('gives up once after the last attempt, then leaves the issue to a person', async () => {
    const world = scenario(baseConfig({ guardRails: { maxAttempts: 1 } }));

    world.workspaces.changed = [];
    await tick(world.dependencies);
    world.clock.advance(1000);

    const giveUp = await tick(world.dependencies);

    expect(giveUp.entries[0]).toMatchObject({
      action: {
        kind: 'give-up',
        attempts: 1,
      },
      result: { kind: 'applied' },
    });

    expect(world.board.statusOf('item-7')).toBe('Todo');

    await world.dependencies.board.setStatus(
      'item-7',
      'Ready',
    );

    const after = await tick(world.dependencies);

    expect(after.entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'gave-up',
    });

    expect(events(world.repoHost.bodies(ISSUE))).toEqual([
      'started#1',
      'failed#1',
      'gave-up#1',
    ]);
  });

  it('reports an item that cannot be planned and goes on with the others', async () => {
    const world = scenario();

    world.board.items.unshift({
      itemId: 'item-404',
      status: 'Ready',
      issue: {
        repository: 'acme/app',
        number: 404,
      },
    });

    const report = await tick(world.dependencies);

    expect(report.entries.map((entry) => entry.result?.kind)).toEqual([
      'error',
      'completed',
    ]);

    expect(report.entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'plan-failed',
    });

    expect(world.logger.entries.some((entry) => entry.event === 'tick.item-error')).toBe(true);
  });
});

describe('tick: errors while acting', () => {
  it('reports an error on one item when writing to GitHub fails, before any agent runs', async () => {
    const world = scenario();

    world.repoHost.addComment = () => Promise.reject(new Error('GitHub is down'));

    const report = await tick(world.dependencies);

    expect(report.entries[0]?.result).toEqual({
      kind: 'error',
      message: 'GitHub is down',
    });

    expect(world.agent.requests).toHaveLength(0);
  });
});

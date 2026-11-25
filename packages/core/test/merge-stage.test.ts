import {
  baseConfig,
  ISSUE,
  scenario,
  type Scenario,
} from '@boardwright/testing';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  diagnose,
  parseMergeMarker,
  tick,
  type MergeFacts,
} from '../src/index.ts';

const PULL_REQUEST = {
  repository: 'acme/app',
  number: 9,
};

const PASSING: MergeFacts = {
  pullRequestId: 'PR_9',
  headSha: 'abc1234',
  isDraft: false,
  labels: [
    'boardwright:agent',
    'boardwright:merge',
  ],
  checks: 'passing',
  mergeability: 'mergeable',
  unresolvedThreads: 0,
  agentVerdict: 'approve',
  changedLines: 120,
  changedPaths: ['src/feature.ts'],
  isAutoMergeEnabled: false,
};

function mergeWorld(facts: Partial<MergeFacts> = {}): Scenario {
  const world = scenario(baseConfig({ stages: [{ id: 'merge' }] }));

  world.board.items[0] = {
    itemId: 'item-7',
    status: 'In review',
    issue: ISSUE,
  };

  world.repoHost.openPullRequests.set(
    'acme/app:agent/issue-7',
    {
      number: 9,
      url: 'https://github.com/acme/app/pull/9',
      headSha: facts.headSha ?? PASSING.headSha,
    },
  );

  world.repoHost.mergeFacts.set(
    9,
    {
      ...PASSING,
      ...facts,
    },
  );

  return world;
}

function audits(world: Scenario): string[] {
  return world.repoHost.bodies(PULL_REQUEST).filter((body) => parseMergeMarker(body) !== undefined);
}

describe('the merge stage', () => {
  it('merges a pull request that passes, at the evaluated head, and leaves an audit comment', async () => {
    const world = mergeWorld();
    const report = await tick(world.dependencies);

    expect(report.entries[0]?.result).toMatchObject({
      kind: 'completed',
      outcome: {
        event: 'succeeded',
        detail: 'Merged https://github.com/acme/app/pull/9.',
      },
    });

    expect(world.merger.requests).toEqual([
      {
        repository: 'acme/app',
        number: 9,
        pullRequestId: 'PR_9',
        headSha: 'abc1234',
        method: 'squash',
      },
    ]);

    expect(audits(world)).toHaveLength(1);

    expect(parseMergeMarker(audits(world)[0] ?? '')).toEqual({
      headSha: 'abc1234',
      decision: 'merged',
      key: 'pass',
    });

    expect(audits(world)[0]).toContain('labelled `boardwright:merge`');
    expect(world.board.moves).toEqual([]);
    expect(world.agent.requests).toEqual([]);
  });

  it('turns on auto-merge when the ruleset still holds the pull request, and does not ask again', async () => {
    const world = mergeWorld();

    world.merger.result = 'auto-merge';

    const report = await tick(world.dependencies);

    expect(report.entries[0]?.result).toMatchObject({ outcome: { detail: 'Turned on auto-merge for https://github.com/acme/app/pull/9; GitHub merges it once the ruleset allows.' } });

    world.repoHost.mergeFacts.set(
      9,
      {
        ...PASSING,
        isAutoMergeEnabled: true,
      },
    );

    expect((await tick(world.dependencies)).entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'up-to-date',
    });

    expect(world.merger.requests).toHaveLength(1);
  });

  it('keeps a pull request touching .github in review and says why, once per head', async () => {
    const world = mergeWorld({ changedPaths: ['.github/workflows/ci.yml'] });
    const report = await tick(world.dependencies);

    expect(report.entries[0]?.result).toMatchObject({ outcome: { detail: 'Did not merge https://github.com/acme/app/pull/9: denied-paths.' } });
    expect(world.merger.requests).toEqual([]);
    expect(audits(world)[0]).toContain('It changes paths only a person merges: .github/workflows/ci.yml.');
    expect(world.board.moves).toEqual([]);

    expect((await tick(world.dependencies)).entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'up-to-date',
    });

    expect(audits(world)).toHaveLength(1);
  });

  it('judges a new head again after a push', async () => {
    const world = mergeWorld({ changedLines: 900 });

    await tick(world.dependencies);

    world.repoHost.mergeFacts.set(
      9,
      {
        ...PASSING,
        headSha: 'def5678',
      },
    );

    world.clock.advance(1000);

    const report = await tick(world.dependencies);

    expect(report.entries[0]?.action).toEqual({
      kind: 'run',
      attempt: 2,
    });

    expect(world.merger.requests.map((request) => request.headSha)).toEqual(['def5678']);
  });

  it.each([
    [
      'waits quietly while checks run',
      { checks: 'pending' },
      'merge-waiting',
    ],
    [
      'leaves alone a pull request without the opt-in label',
      { labels: ['boardwright:agent'] },
      'merge-not-opted-in',
    ],
  ] as const)('%s', async (
    _case,
    facts,
    reason,
  ) => {
    const world = mergeWorld(facts);
    const report = await tick(world.dependencies);

    expect(report.entries[0]?.action).toEqual({
      kind: 'skip',
      reason,
    });

    expect(world.repoHost.bodies(PULL_REQUEST)).toEqual([]);
    expect(world.repoHost.bodies(ISSUE)).toEqual([]);
    expect(world.logger.entries.some((entry) => entry.event === 'merge.policy')).toBe(true);
  });

  it('skips an item without an open pull request', async () => {
    const world = mergeWorld();

    world.repoHost.openPullRequests.clear();

    expect((await tick(world.dependencies)).entries[0]?.action).toEqual({
      kind: 'skip',
      reason: 'no-pull-request',
    });
  });

  it('re-reads the pull request right before acting and does nothing when it changed meanwhile', async () => {
    const world = mergeWorld();
    const getMergeFacts = world.repoHost.getMergeFacts.bind(world.repoHost);
    let reads = 0;

    world.repoHost.getMergeFacts = (
      repository,
      number,
    ) => {
      reads += 1;

      return reads > 2
        ? Promise.resolve({
            ...PASSING,
            unresolvedThreads: 0,
            checks: 'pending',
          })
        : getMergeFacts(
            repository,
            number,
          );
    };

    const report = await tick(world.dependencies);

    expect(report.entries[0]?.result).toMatchObject({ outcome: { detail: 'Nothing to do for https://github.com/acme/app/pull/9 yet (waiting).' } });
    expect(world.merger.requests).toEqual([]);
  });

  it('fails when the pull request closed between planning and acting', async () => {
    const world = mergeWorld();
    const findOpen = world.repoHost.findOpenPullRequest.bind(world.repoHost);
    let calls = 0;

    world.repoHost.findOpenPullRequest = (
      repository,
      head,
    ) => {
      calls += 1;

      return calls > 2 ? Promise.resolve(undefined) : findOpen(
        repository,
        head,
      );
    };

    expect((await tick(world.dependencies)).entries[0]?.result).toMatchObject({ outcome: { event: 'failed' } });
  });

  it('needs only its own Status on the board and no playbook', async () => {
    const world = mergeWorld();

    world.board.statusOptions = ['In review'];

    const report = await diagnose({
      config: world.dependencies.config,
      board: world.board,
      repoHost: world.repoHost,
      context: world.context,
    });

    expect(report.hasFailures).toBe(false);
    expect(world.context.selectors).toEqual([]);
  });

  it('warns about merge labels the repository lacks', async () => {
    const world = mergeWorld();

    world.repoHost.labels.set(
      'acme/app',
      new Set([
        'boardwright:agent',
        'boardwright:merge',
      ]),
    );

    const report = await diagnose({
      config: world.dependencies.config,
      board: world.board,
      repoHost: world.repoHost,
      context: world.context,
    });

    expect(report.checks.filter((check) => check.status === 'warn').map((check) => check.detail)).toEqual(['The merge label "boardwright:hold" does not exist; create it to let a person hold a pull request back.']);
  });
});

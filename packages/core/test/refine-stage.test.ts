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
  parseMarker,
  PLAN_MARKER,
  tick,
} from '../src/index.ts';

function refineWorld(overrides: Record<string, unknown> = {}): Scenario {
  const world = scenario(baseConfig({
    stages: [{ id: 'refine' }],
    ...overrides,
  }));

  world.board.statusOptions = [
    'Todo',
    'Refine',
    'Ready',
    'In Progress',
    'In review',
    'Done',
  ];

  world.board.items[0] = {
    itemId: 'item-7',
    status: 'Refine',
    issue: ISSUE,
  };

  world.agent.result = {
    status: 'completed',
    summary: 'Planned.',
    pullRequest: undefined,
    review: undefined,
    addressedThreadIds: [],
    plan: '## Scope\n\nAdd the feature.\n\n## Acceptance criteria\n\n- [ ] It works.',
  };

  return world;
}

function planComments(world: Scenario): string[] {
  return world.repoHost.bodies(ISSUE).filter((body) => body.startsWith(PLAN_MARKER));
}

describe('the refine stage', () => {
  it('posts the plan on the issue as a read-only task and moves the card to Ready', async () => {
    const world = refineWorld();
    const report = await tick(world.dependencies);

    expect(report.entries[0]?.result).toMatchObject({
      kind: 'completed',
      outcome: {
        event: 'succeeded',
        detail: 'Posted the plan on the issue.',
      },
    });

    expect(world.agent.requests[0]).toMatchObject({
      stage: 'refine',
      task: 'plan',
    });

    expect(world.agent.requests[0]?.prompt).toContain('Read only: do not change, commit or push anything.');

    expect(world.context.selectors).toEqual([
      {
        phase: 'P',
        agent: 'architect-specialist',
      },
    ]);

    expect(planComments(world)).toEqual([`${PLAN_MARKER}\n**boardwright plan** for #7\n\n## Scope\n\nAdd the feature.\n\n## Acceptance criteria\n\n- [ ] It works.`]);
    expect(world.board.statusOf('item-7')).toBe('Ready');
    expect(world.workspaces.pushed).toEqual([]);
    expect(world.workspaces.disposed).toHaveLength(1);
  });

  it('moves the card on again when the plan is in place, and plans again once a person deletes it', async () => {
    const world = refineWorld();

    await tick(world.dependencies);

    await world.board.setStatus(
      'item-7',
      'Refine',
    );

    expect((await tick(world.dependencies)).entries[0]?.action).toEqual({
      kind: 'repair-status',
      status: 'Ready',
    });

    await world.board.setStatus(
      'item-7',
      'Refine',
    );

    const comments = world.repoHost.comments.get('acme/app#7') ?? [];

    world.repoHost.comments.set(
      'acme/app#7',
      comments.filter((comment) => !comment.body.startsWith(PLAN_MARKER)),
    );

    world.clock.advance(1000);

    expect((await tick(world.dependencies)).entries[0]?.action).toEqual({
      kind: 'run',
      attempt: 2,
    });
  });

  it.each([
    [
      'blocked',
      {
        status: 'blocked',
        summary: 'Which API?',
        plan: undefined,
      },
      'Todo',
    ],
    [
      'failed',
      {
        status: 'completed',
        summary: 'Done.',
        plan: '   ',
      },
      'Refine',
    ],
  ] as const)('posts no plan when the run ends %s, and sends the card to %s', async (
    event,
    result,
    status,
  ) => {
    const world = refineWorld();

    world.agent.result = {
      ...world.agent.result,
      ...result,
    };

    const report = await tick(world.dependencies);

    expect(report.entries[0]?.result).toMatchObject({ outcome: { event } });
    expect(planComments(world)).toEqual([]);
    expect(world.board.statusOf('item-7')).toBe(status);
    expect(events(world).at(-1)).toBe(event);
  });

  it('needs its three Status on the board', async () => {
    const world = refineWorld();

    world.board.statusOptions = [
      'Todo',
      'Ready',
    ];

    const report = await diagnose({
      config: world.dependencies.config,
      board: world.board,
      repoHost: world.repoHost,
      context: world.context,
    });

    expect(report.checks.filter((check) => check.status === 'fail').map((check) => check.detail)).toEqual(['The Status "Refine" is not an option of the board; add it, or change the stage.']);
  });
});

function events(world: Scenario): string[] {
  return world.repoHost.bodies(ISSUE).flatMap((body) => {
    const marker = parseMarker(body);

    return marker === undefined ? [] : [marker.event];
  });
}

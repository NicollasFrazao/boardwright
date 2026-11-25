import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  inferFieldValue,
  issuesNotOnBoard,
  parentsToStart,
  tick,
  type HygieneItem,
} from '../src/index.ts';
import {
  baseConfig,
  scenario,
  type Scenario,
} from '@boardwright/testing';

function item(
  itemId: string,
  overrides: Partial<HygieneItem> = {},
): HygieneItem {
  return {
    itemId,
    status: null,
    issue: {
      repository: 'acme/app',
      number: Number(itemId.replace(
        /\D/gu,
        '',
      )),
    },
    fields: {},
    parent: undefined,
    ...overrides,
  };
}

const RULE = {
  notStarted: [
    'Todo',
    'Ready',
  ],
  started: [
    'In Progress',
    'In review',
  ],
  status: 'In Progress',
};

describe('inferFieldValue', () => {
  it('takes the most common value of the same repository, ignoring the item itself and other repositories', () => {
    const target = item('item-1');

    const items = [
      target,
      item(
        'item-2',
        { fields: { Track: 'Showcase' } },
      ),
      item(
        'item-3',
        { fields: { Track: 'Showcase' } },
      ),
      item(
        'item-4',
        { fields: { Track: 'Profile' } },
      ),
      item(
        'item-5',
        {
          issue: {
            repository: 'acme/other',
            number: 5,
          },
          fields: { Track: 'Profile' },
        },
      ),
    ];

    expect(inferFieldValue(
      items,
      target,
      'Track',
    )).toBe('Showcase');
  });

  it('breaks a tie by name, and has nothing to infer without another valued item', () => {
    const target = item('item-1');

    expect(inferFieldValue(
      [
        target,
        item(
          'item-2',
          { fields: { Track: 'Zeta' } },
        ),
        item(
          'item-3',
          { fields: { Track: 'Alpha' } },
        ),
      ],
      target,
      'Track',
    )).toBe('Alpha');

    expect(inferFieldValue(
      [
        target,
        item('item-2'),
      ],
      target,
      'Track',
    )).toBeUndefined();
  });
});

describe('parentsToStart', () => {
  const parent = item(
    'item-1',
    { status: 'Todo' },
  );

  const child = (
    itemId: string,
    status: string | null,
  ): HygieneItem => item(
    itemId,
    {
      status,
      parent: parent.issue,
    },
  );

  it('moves a parent that has not started once a sub-issue has, once even with several', () => {
    expect(parentsToStart(
      [
        parent,
        child(
          'item-2',
          'In review',
        ),
        child(
          'item-3',
          'In Progress',
        ),
      ],
      RULE,
    )).toEqual([
      {
        parent,
        child: {
          repository: 'acme/app',
          number: 2,
        },
      },
    ]);
  });

  it('counts an empty Status as not started', () => {
    expect(parentsToStart(
      [
        {
          ...parent,
          status: null,
        },
        child(
          'item-2',
          'In Progress',
        ),
      ],
      RULE,
    )).toHaveLength(1);
  });

  it('leaves a parent that started, a parent off the board, and sub-issues that have not started', () => {
    expect(parentsToStart(
      [
        {
          ...parent,
          status: 'In review',
        },
        child(
          'item-2',
          'In Progress',
        ),
      ],
      RULE,
    )).toEqual([]);

    expect(parentsToStart(
      [child(
        'item-2',
        'In Progress',
      )],
      RULE,
    )).toEqual([]);

    expect(parentsToStart(
      [
        parent,
        child(
          'item-2',
          'Ready',
        ),
        child(
          'item-3',
          null,
        ),
      ],
      RULE,
    )).toEqual([]);
  });
});

describe('issuesNotOnBoard', () => {
  it('keeps the issues the board does not have', () => {
    expect(issuesNotOnBoard(
      [item('item-1')],
      [
        {
          repository: 'acme/app',
          number: 1,
        },
        {
          repository: 'acme/app',
          number: 9,
        },
      ],
    )).toEqual([
      {
        repository: 'acme/app',
        number: 9,
      },
    ]);
  });
});

/** A world whose config turns board hygiene on, with no item in a stage's Status. */
function hygieneWorld(board: Record<string, unknown>): Scenario {
  const world = scenario(baseConfig({ board }));

  world.board.items.length = 0;

  world.board.singleSelectFields = {
    Track: [
      'Showcase',
      'Profile',
    ],
  };

  return world;
}

describe('tick: board hygiene', () => {
  it('does nothing to the board without a board section', async () => {
    const world = scenario();
    const report = await tick(world.dependencies);

    expect(report.board).toEqual([]);
    expect(world.board.added).toEqual([]);
    expect(world.board.fieldChanges).toEqual([]);
  });

  it('adds the open issues created in the window that are not on the board, and only those', async () => {
    const world = hygieneWorld({ addNewIssues: true });

    world.board.items.push({
      itemId: 'item-1',
      status: 'Todo',
      issue: {
        repository: 'acme/app',
        number: 1,
      },
    });

    world.repoHost.recentIssues.set(
      'acme/app',
      [
        {
          number: 1,
          createdAt: '2026-11-24T10:00:00Z',
        },
        {
          number: 2,
          createdAt: '2026-11-23T12:00:00Z',
        },
        {
          number: 3,
          createdAt: '2026-11-20T12:00:00Z',
        },
      ],
    );

    const report = await tick(world.dependencies);

    expect(report.board).toEqual([
      {
        action: {
          kind: 'add-issue',
          issue: {
            repository: 'acme/app',
            number: 2,
          },
        },
        result: { kind: 'applied' },
      },
    ]);

    // A second tick finds the issue on the board and adds nothing.
    expect((await tick(world.dependencies)).board).toEqual([]);
    expect(world.board.added).toHaveLength(1);
  });

  it('fills a missing field from the repository\'s other items, a new issue included, and leaves set values', async () => {
    const world = hygieneWorld({
      addNewIssues: true,
      inferFields: ['Track'],
    });

    world.board.items.push(
      {
        itemId: 'item-1',
        status: 'Done',
        issue: {
          repository: 'acme/app',
          number: 1,
        },
        fields: { Track: 'Showcase' },
      },
      {
        itemId: 'item-4',
        status: 'Todo',
        issue: {
          repository: 'acme/app',
          number: 4,
        },
      },
    );

    world.repoHost.recentIssues.set(
      'acme/app',
      [
        {
          number: 5,
          createdAt: '2026-11-24T11:00:00Z',
        },
      ],
    );

    const report = await tick(world.dependencies);

    expect(report.board.map((entry) => entry.action)).toEqual([
      {
        kind: 'add-issue',
        issue: {
          repository: 'acme/app',
          number: 5,
        },
      },
      {
        kind: 'set-field',
        issue: {
          repository: 'acme/app',
          number: 4,
        },
        field: 'Track',
        value: 'Showcase',
      },
      {
        kind: 'set-field',
        issue: {
          repository: 'acme/app',
          number: 5,
        },
        field: 'Track',
        value: 'Showcase',
      },
    ]);

    expect(world.board.fieldOf(
      'item-1',
      'Track',
    )).toBe('Showcase');

    expect((await tick(world.dependencies)).board).toEqual([]);
  });

  it('skips a field the board does not have, with a warning in the log', async () => {
    const world = hygieneWorld({ inferFields: ['Area'] });

    world.board.items.push(
      {
        itemId: 'item-1',
        status: 'Done',
        issue: {
          repository: 'acme/app',
          number: 1,
        },
        fields: { Area: 'API' },
      },
      {
        itemId: 'item-2',
        status: 'Todo',
        issue: {
          repository: 'acme/app',
          number: 2,
        },
      },
    );

    expect((await tick(world.dependencies)).board).toEqual([]);

    expect(world.logger.entries).toContainEqual(expect.objectContaining({
      event: 'board.field-missing',
    }));
  });

  it('moves a parent that has not started, and the stages then see it where hygiene left it', async () => {
    const world = hygieneWorld({ followSubIssues: true });

    world.board.items.push(
      {
        itemId: 'item-1',
        status: 'Ready',
        issue: {
          repository: 'acme/app',
          number: 1,
        },
      },
      {
        itemId: 'item-2',
        status: 'In review',
        issue: {
          repository: 'acme/app',
          number: 2,
        },
        parent: {
          repository: 'acme/app',
          number: 1,
        },
      },
    );

    const report = await tick(world.dependencies);

    expect(report.board).toEqual([
      {
        action: {
          kind: 'start-parent',
          issue: {
            repository: 'acme/app',
            number: 1,
          },
          child: {
            repository: 'acme/app',
            number: 2,
          },
          status: 'In Progress',
        },
        result: { kind: 'applied' },
      },
    ]);

    // The parent left Ready before the stages ran, so the implement stage does not pick it up.
    expect(report.entries).toEqual([]);
    expect(world.board.statusOf('item-1')).toBe('In Progress');
  });

  it('plans without writing in a dry run', async () => {
    const world = hygieneWorld({
      addNewIssues: true,
      inferFields: ['Track'],
      followSubIssues: true,
    });

    world.board.items.push(
      {
        itemId: 'item-1',
        status: 'Todo',
        issue: {
          repository: 'acme/app',
          number: 1,
        },
        fields: { Track: 'Profile' },
      },
      {
        itemId: 'item-2',
        status: 'In Progress',
        issue: {
          repository: 'acme/app',
          number: 2,
        },
        parent: {
          repository: 'acme/app',
          number: 1,
        },
      },
    );

    world.repoHost.recentIssues.set(
      'acme/app',
      [
        {
          number: 3,
          createdAt: '2026-11-24T11:00:00Z',
        },
      ],
    );

    const report = await tick(
      world.dependencies,
      { dryRun: true },
    );

    expect(report.board.map((entry) => [
      entry.action.kind,
      entry.action.issue.number,
      entry.result,
    ])).toEqual([
      [
        'add-issue',
        3,
        undefined,
      ],
      [
        'set-field',
        2,
        undefined,
      ],
      [
        'set-field',
        3,
        undefined,
      ],
      [
        'start-parent',
        1,
        undefined,
      ],
    ]);

    expect(world.board.added).toEqual([]);
    expect(world.board.fieldChanges).toEqual([]);
    expect(world.board.moves).toEqual([]);
  });

  it('reports a failed change on its entry and goes on with the others; an unreachable repository adds nothing', async () => {
    const world = hygieneWorld({
      addNewIssues: true,
      inferFields: ['Track'],
    });

    world.dependencies.config.repositories.push('acme/down');
    world.repoHost.unreachable.add('acme/down');

    world.board.items.push(
      {
        itemId: 'item-1',
        status: 'Done',
        issue: {
          repository: 'acme/app',
          number: 1,
        },
        fields: { Track: 'Showcase' },
      },
      {
        itemId: 'item-2',
        status: 'Todo',
        issue: {
          repository: 'acme/app',
          number: 2,
        },
      },
      {
        itemId: 'item-3',
        status: 'Todo',
        issue: {
          repository: 'acme/app',
          number: 3,
        },
      },
    );

    world.board.failing.add('item-2');

    const report = await tick(world.dependencies);

    expect(report.board.map((entry) => [
      entry.action.issue.number,
      entry.result?.kind,
    ])).toEqual([
      [
        2,
        'error',
      ],
      [
        3,
        'applied',
      ],
    ]);

    expect(world.logger.entries).toContainEqual(expect.objectContaining({
      event: 'board.error',
    }));
  });

  it('changes only items of the allowlisted repositories', async () => {
    const world = hygieneWorld({
      inferFields: ['Track'],
      followSubIssues: true,
    });

    const other = (number: number): {
      repository: string;
      number: number;
    } => ({
      repository: 'someone/else',
      number,
    });

    world.board.items.push(
      {
        itemId: 'item-1',
        status: 'Done',
        issue: other(1),
        fields: { Track: 'Profile' },
      },
      {
        itemId: 'item-2',
        status: 'Todo',
        issue: other(2),
      },
      {
        itemId: 'item-3',
        status: 'In Progress',
        issue: {
          repository: 'acme/app',
          number: 3,
        },
        parent: other(2),
      },
    );

    expect((await tick(world.dependencies)).board).toEqual([]);
    expect(world.board.fieldChanges).toEqual([]);
    expect(world.board.moves).toEqual([]);
  });
});

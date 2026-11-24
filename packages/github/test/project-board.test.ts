import {
  GitHubReplay,
  graphqlVariables,
  type ReplayRoute,
} from '@boardwright/testing';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createGitHubClient,
  ProjectBoard,
} from '../src/index.ts';

const PROJECT: ReplayRoute = {
  method: 'POST',
  path: '/graphql',
  query: 'repositoryOwner',
  body: {
    data: {
      repositoryOwner: {
        projectV2: {
          id: 'PVT_1',
          title: 'Portfolio roadmap',
          field: {
            id: 'FIELD_STATUS',
            options: [
              {
                id: 'opt-todo',
                name: 'Todo',
              },
              {
                id: 'opt-ready',
                name: 'Ready',
              },
              {
                id: 'opt-review',
                name: 'In review',
              },
            ],
          },
        },
      },
    },
  },
};

function itemsPage(
  after: string | null,
  nodes: unknown[],
  endCursor: string | null,
): ReplayRoute {
  return {
    method: 'POST',
    path: '/graphql',
    query: 'items(first: 100',
    when: (request) => graphqlVariables(request).after === after,
    body: {
      data: {
        node: {
          items: {
            pageInfo: {
              hasNextPage: endCursor !== null,
              endCursor,
            },
            nodes,
          },
        },
      },
    },
  };
}

function boardWith(routes: ReplayRoute[]): {
  board: ProjectBoard;
  replay: GitHubReplay;
} {
  const replay = new GitHubReplay(routes);

  const board = new ProjectBoard(
    createGitHubClient({
      token: 'test-token',
      fetch: replay.fetch,
    }),
    {
      owner: 'acme',
      number: 3,
      statusField: 'Status',
    },
  );

  return {
    board,
    replay,
  };
}

describe('ProjectBoard', () => {
  it('describes the board, reading the project once', async () => {
    const {
      board,
      replay,
    } = boardWith([PROJECT]);

    expect(await board.describe()).toEqual({
      title: 'Portfolio roadmap',
      statusOptions: [
        'Todo',
        'Ready',
        'In review',
      ],
    });

    await board.describe();
    expect(replay.requests).toHaveLength(1);

    expect(graphqlVariables(replay.nth(0))).toEqual({
      login: 'acme',
      number: 3,
      field: 'Status',
    });
  });

  it('reports a board without a single-select field of that name', async () => {
    const { board } = boardWith([
      {
        ...PROJECT,
        body: {
          data: {
            repositoryOwner: {
              projectV2: {
                id: 'PVT_1',
                title: 'No status',
                field: null,
              },
            },
          },
        },
      },
    ]);

    expect(await board.describe()).toEqual({
      title: 'No status',
      statusOptions: undefined,
    });

    await expect(board.setStatus(
      'item',
      'Ready',
    )).rejects.toThrow('The board has no Status option "Ready".');
  });

  it('fails clearly when the owner has no such project', async () => {
    const { board } = boardWith([
      {
        ...PROJECT,
        body: { data: { repositoryOwner: null } },
      },
    ]);

    await expect(board.describe()).rejects.toThrow('No project #3 owned by acme.');
  });

  it('lists the issue items of every page and leaves out drafts and pull requests', async () => {
    const { board } = boardWith([
      PROJECT,
      itemsPage(
        null,
        [
          {
            id: 'item-1',
            fieldValueByName: { name: 'Ready' },
            content: {
              number: 1,
              repository: { nameWithOwner: 'acme/app' },
            },
          },
          {
            id: 'draft',
            fieldValueByName: null,
            content: {},
          },
        ],
        'cursor-1',
      ),
      itemsPage(
        'cursor-1',
        [
          {
            id: 'item-2',
            fieldValueByName: null,
            content: {
              number: 2,
              repository: { nameWithOwner: 'acme/api' },
            },
          },
          {
            id: 'pull-request',
            fieldValueByName: { name: 'Done' },
            content: null,
          },
        ],
        null,
      ),
    ]);

    expect(await board.listItems()).toEqual([
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
        status: null,
        issue: {
          repository: 'acme/api',
          number: 2,
        },
      },
    ]);
  });

  it('sets an existing option by its id', async () => {
    const {
      board,
      replay,
    } = boardWith([
      PROJECT,
      {
        method: 'POST',
        path: '/graphql',
        query: 'updateProjectV2ItemFieldValue',
        body: { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'item-1' } } } },
      },
    ]);

    await board.setStatus(
      'item-1',
      'In review',
    );

    expect(graphqlVariables(replay.nth(1))).toEqual({
      project: 'PVT_1',
      item: 'item-1',
      field: 'FIELD_STATUS',
      option: 'opt-review',
    });
  });

  it('never creates an option: an unknown Status is an error and nothing is sent', async () => {
    const {
      board,
      replay,
    } = boardWith([PROJECT]);

    await expect(board.setStatus(
      'item-1',
      'Blocked',
    )).rejects.toThrow('The board has no Status option "Blocked".');

    expect(replay.requests).toHaveLength(1);
  });
});

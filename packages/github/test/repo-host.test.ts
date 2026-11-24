import {
  GitHubReplay,
  type ReplayRoute,
} from '@boardwright/testing';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createGitHubClient,
  GitHubRepoHost,
} from '../src/index.ts';

const ISSUE = {
  repository: 'acme/app',
  number: 7,
};

function hostWith(routes: ReplayRoute[]): {
  host: GitHubRepoHost;
  replay: GitHubReplay;
} {
  const replay = new GitHubReplay(routes);

  return {
    host: new GitHubRepoHost(createGitHubClient({
      token: 'test-token',
      fetch: replay.fetch,
    })),
    replay,
  };
}

function labeled(
  login: string,
  label: string,
): unknown {
  return {
    event: 'labeled',
    actor: { login },
    label: { name: label },
  };
}

function permission(
  login: string,
  body: unknown,
  status = 200,
): ReplayRoute {
  return {
    method: 'GET',
    path: `/repos/acme/app/collaborators/${login}/permission`,
    status,
    body,
  };
}

describe('GitHubRepoHost: issues and comments', () => {
  it('reads an issue: label names, an empty body, closed state', async () => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/issues/7',
        body: {
          title: 'Add the feature',
          body: null,
          state: 'closed',
          labels: [
            { name: 'agent' },
            'bug',
          ],
        },
      },
    ]);

    expect(await host.getIssue(ISSUE)).toEqual({
      ref: ISSUE,
      title: 'Add the feature',
      body: '',
      labels: [
        'agent',
        'bug',
      ],
      isOpen: false,
    });
  });

  it('reads every page of comments, padding ids so their order is their creation order', async () => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/issues/7/comments?per_page=100',
        headers: { link: '<https://api.github.com/repos/acme/app/issues/7/comments?per_page=100&page=2>; rel="next"' },
        body: [
          {
            id: 999,
            body: 'first',
            created_at: '2026-11-24T01:55:00Z',
          },
        ],
      },
      {
        method: 'GET',
        path: '/repos/acme/app/issues/7/comments?per_page=100&page=2',
        body: [
          {
            id: 1000,
            body: null,
            created_at: '2026-11-24T01:55:00Z',
          },
        ],
      },
    ]);

    const comments = await host.listComments(ISSUE);

    expect(comments).toEqual([
      {
        id: '00000000000000000999',
        body: 'first',
        createdAt: new Date('2026-11-24T01:55:00Z'),
      },
      {
        id: '00000000000000001000',
        body: '',
        createdAt: new Date('2026-11-24T01:55:00Z'),
      },
    ]);

    expect(comments.map((comment) => comment.id).sort((
      left,
      right,
    ) => left.localeCompare(right))).toEqual(comments.map((comment) => comment.id));
  });

  it('posts a comment', async () => {
    const {
      host,
      replay,
    } = hostWith([
      {
        method: 'POST',
        path: '/repos/acme/app/issues/7/comments',
        status: 201,
        body: { id: 1 },
      },
    ]);

    await host.addComment(
      ISSUE,
      'hello',
    );

    expect(replay.nth(0).body).toEqual({ body: 'hello' });
  });
});

describe('GitHubRepoHost: who released the issue', () => {
  const events: ReplayRoute = {
    method: 'GET',
    path: '/repos/acme/app/issues/7/events',
    body: [
      labeled(
        'stranger',
        'agent',
      ),
      labeled(
        'maintainer',
        'agent',
      ),
      labeled(
        'someone-else',
        'bug',
      ),
      {
        event: 'commented',
        actor: { login: 'x' },
      },
    ],
  };

  it('takes the latest person who added the label, with their role', async () => {
    const { host } = hostWith([
      events,
      permission(
        'maintainer',
        {
          permission: 'write',
          role_name: 'maintain',
        },
      ),
    ]);

    expect(await host.findLabelActor(
      ISSUE,
      'agent',
    )).toEqual({
      login: 'maintainer',
      permission: 'maintain',
    });
  });

  it('falls back to the coarse permission when the role is custom', async () => {
    const { host } = hostWith([
      events,
      permission(
        'maintainer',
        {
          permission: 'read',
          role_name: 'custom-auditor',
        },
      ),
    ]);

    expect((await host.findLabelActor(
      ISSUE,
      'agent',
    ))?.permission).toBe('read');
  });

  it('gives no permission to someone who is not a collaborator (a bot, a stranger)', async () => {
    const { host } = hostWith([
      {
        ...events,
        body: [labeled(
          'dependabot[bot]',
          'agent',
        )],
      },
      permission(
        'dependabot[bot]',
        { message: 'Not Found' },
        404,
      ),
    ]);

    expect(await host.findLabelActor(
      ISSUE,
      'agent',
    )).toEqual({
      login: 'dependabot[bot]',
      permission: 'none',
    });
  });

  it('returns nothing when no one added the label', async () => {
    const { host } = hostWith([events]);

    expect(await host.findLabelActor(
      ISSUE,
      'needs-human',
    )).toBeUndefined();
  });

  it('lets other permission errors through', async () => {
    const { host } = hostWith([
      events,
      permission(
        'maintainer',
        { message: 'Server Error' },
        500,
      ),
    ]);

    await expect(host.findLabelActor(
      ISSUE,
      'agent',
    )).rejects.toMatchObject({ status: 500 });
  });
});

describe('GitHubRepoHost: repository and pull requests', () => {
  it('reads the default branch', async () => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app',
        body: { default_branch: 'master' },
      },
    ]);

    expect(await host.getDefaultBranch('acme/app')).toBe('master');
  });

  it('finds the open pull request of a branch in the same repository', async () => {
    const {
      host,
      replay,
    } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/pulls',
        body: [
          {
            number: 15,
            html_url: 'https://github.com/acme/app/pull/15',
            head: { sha: 'abc1234' },
          },
        ],
      },
    ]);

    expect(await host.findOpenPullRequest(
      'acme/app',
      'agent/issue-7',
    )).toEqual({
      number: 15,
      url: 'https://github.com/acme/app/pull/15',
      headSha: 'abc1234',
    });

    const query = new URLSearchParams(replay.nth(0).path.split('?')[1]);

    expect(query.get('state')).toBe('open');
    expect(query.get('head')).toBe('acme:agent/issue-7');
  });

  it('returns nothing when the branch has no open pull request', async () => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/pulls',
        body: [],
      },
    ]);

    expect(await host.findOpenPullRequest(
      'acme/app',
      'agent/issue-7',
    )).toBeUndefined();
  });

  it('opens a pull request from the draft', async () => {
    const {
      host,
      replay,
    } = hostWith([
      {
        method: 'POST',
        path: '/repos/acme/app/pulls',
        status: 201,
        body: {
          number: 16,
          html_url: 'https://github.com/acme/app/pull/16',
          head: { sha: 'def5678' },
        },
      },
    ]);

    const draft = {
      repository: 'acme/app',
      head: 'agent/issue-7',
      base: 'master',
      title: 'feat: x',
      body: 'Closes #7',
    };

    expect(await host.openPullRequest(draft)).toEqual({
      number: 16,
      url: 'https://github.com/acme/app/pull/16',
      headSha: 'def5678',
    });

    expect(replay.nth(0).body).toEqual({
      head: 'agent/issue-7',
      base: 'master',
      title: 'feat: x',
      body: 'Closes #7',
    });
  });
});

describe('GitHubRepoHost: labels and files', () => {
  it.each([
    [
      200,
      true,
    ],
    [
      404,
      false,
    ],
  ])('hasLabel on HTTP %i → %s', async (
    status,
    expected,
  ) => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/labels/agent',
        status,
        body: { name: 'agent' },
      },
    ]);

    expect(await host.hasLabel(
      'acme/app',
      'agent',
    )).toBe(expected);
  });

  it('lets other label errors through', async () => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/labels/agent',
        status: 500,
        body: {},
      },
    ]);

    await expect(host.hasLabel(
      'acme/app',
      'agent',
    )).rejects.toMatchObject({ status: 500 });
  });

  it('reads a file as raw text', async () => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/contents/.context/agents/code-reviewer.md',
        body: '---\nagentType: code-reviewer\n---\n',
      },
    ]);

    expect(await host.readFile(
      'acme/app',
      '.context/agents/code-reviewer.md',
    )).toBe('---\nagentType: code-reviewer\n---\n');
  });

  it.each([
    [
      'missing',
      404,
      { message: 'Not Found' },
    ],
    [
      'a directory',
      200,
      [{ name: 'x.md' }],
    ],
  ])('reads nothing from a path that is %s', async (
    _case,
    status,
    body,
  ) => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/contents/.context',
        status,
        body,
      },
    ]);

    expect(await host.readFile(
      'acme/app',
      '.context',
    )).toBeUndefined();
  });

  it('lists a directory sorted, and nothing for a missing path or a file', async () => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/contents/.context/skills',
        body: [
          { name: 'pr-review' },
          { name: 'code-review' },
        ],
      },
      {
        method: 'GET',
        path: '/repos/acme/app/contents/nope',
        status: 404,
        body: {},
      },
      {
        method: 'GET',
        path: '/repos/acme/app/contents/README.md',
        body: { name: 'README.md' },
      },
    ]);

    expect(await host.listDirectory(
      'acme/app',
      '.context/skills',
    )).toEqual([
      'code-review',
      'pr-review',
    ]);

    expect(await host.listDirectory(
      'acme/app',
      'nope',
    )).toEqual([]);

    expect(await host.listDirectory(
      'acme/app',
      'README.md',
    )).toEqual([]);
  });

  it('lets other content errors through', async () => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/contents/x',
        status: 500,
        body: {},
      },
    ]);

    await expect(host.readFile(
      'acme/app',
      'x',
    )).rejects.toMatchObject({ status: 500 });

    await expect(host.listDirectory(
      'acme/app',
      'x',
    )).rejects.toMatchObject({ status: 500 });
  });
});

describe('GitHubRepoHost: reviews', () => {
  const marker = '<!-- boardwright:review v=1 verdict=approve head=abc1234 -->';

  it.each([
    [
      'a marked review of the head',
      [
        {
          commit_id: 'abc1234',
          body: `${marker}\nLooks good.`,
        },
      ],
      true,
    ],
    [
      'only a review of an older commit',
      [
        {
          commit_id: 'old0000',
          body: '<!-- boardwright:review v=1 verdict=changes head=old0000 -->',
        },
      ],
      false,
    ],
    [
      'only a person\'s review of the head',
      [
        {
          commit_id: 'abc1234',
          body: 'LGTM',
        },
      ],
      false,
    ],
  ])('hasAgentReview with %s → %s', async (
    _case,
    reviews,
    expected,
  ) => {
    const { host } = hostWith([
      {
        method: 'GET',
        path: '/repos/acme/app/pulls/15/reviews',
        body: reviews,
      },
    ]);

    expect(await host.hasAgentReview(
      'acme/app',
      15,
      'abc1234',
    )).toBe(expected);
  });

  const draft = {
    repository: 'acme/app',
    number: 15,
    headSha: 'abc1234',
    body: `${marker}\nOne finding.`,
    comments: [
      {
        path: 'src/a.ts',
        line: 3,
        body: 'Name this constant.',
      },
    ],
  };

  it('posts a review that only comments, with its line comments on the new side', async () => {
    const {
      host,
      replay,
    } = hostWith([
      {
        method: 'POST',
        path: '/repos/acme/app/pulls/15/reviews',
        body: { id: 1 },
      },
    ]);

    await host.submitReview(draft);

    expect(replay.nth(0).body).toEqual({
      commit_id: 'abc1234',
      event: 'COMMENT',
      body: draft.body,
      comments: [
        {
          path: 'src/a.ts',
          line: 3,
          side: 'RIGHT',
          body: 'Name this constant.',
        },
      ],
    });
  });

  it('folds the line comments into the body when GitHub cannot place them', async () => {
    let calls = 0;

    const {
      host,
      replay,
    } = hostWith([
      {
        method: 'POST',
        path: '/repos/acme/app/pulls/15/reviews',
        when: () => {
          calls += 1;

          return calls === 1;
        },
        status: 422,
        body: { message: 'Line could not be resolved' },
      },
      {
        method: 'POST',
        path: '/repos/acme/app/pulls/15/reviews',
        body: { id: 2 },
      },
    ]);

    await host.submitReview(draft);

    const retry = replay.nth(1).body as {
      body: string;
      comments?: unknown;
    };

    expect(retry.comments).toBeUndefined();
    expect(retry.body).toContain('- `src/a.ts:3` Name this constant.');
  });

  it('lets other review errors through', async () => {
    const { host } = hostWith([
      {
        method: 'POST',
        path: '/repos/acme/app/pulls/15/reviews',
        status: 500,
        body: {},
      },
    ]);

    await expect(host.submitReview(draft)).rejects.toMatchObject({ status: 500 });
  });
});

describe('GitHubRepoHost: feedback', () => {
  function feedbackRoute(pullRequest: unknown): ReplayRoute {
    return {
      method: 'POST',
      path: '/graphql',
      query: 'reviewThreads',
      body: { data: { repository: { pullRequest } } },
    };
  }

  it('returns the unresolved threads with their latest comment and the failing checks only', async () => {
    const {
      host,
      replay,
    } = hostWith([
      feedbackRoute({
        reviewThreads: {
          nodes: [
            {
              id: 'PRRT_1',
              isResolved: false,
              path: 'src/a.ts',
              line: 3,
              comments: { nodes: [{ body: 'Name it.' }] },
            },
            {
              id: 'PRRT_2',
              isResolved: true,
              path: 'src/b.ts',
              line: 1,
              comments: { nodes: [{ body: 'Done.' }] },
            },
            {
              id: 'PRRT_3',
              isResolved: false,
              path: 'README.md',
              line: null,
              comments: { nodes: [] },
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    nodes: [
                      {
                        name: 'test',
                        conclusion: 'FAILURE',
                      },
                      {
                        name: 'lint',
                        conclusion: 'SUCCESS',
                      },
                      {
                        name: 'CodeQL',
                        conclusion: null,
                      },
                      {
                        context: 'ci/legacy',
                        state: 'ERROR',
                      },
                      {
                        context: 'ci/ok',
                        state: 'SUCCESS',
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    ]);

    expect(await host.getFeedback(
      'acme/app',
      9,
    )).toEqual({
      threads: [
        {
          id: 'PRRT_1',
          path: 'src/a.ts',
          line: 3,
          body: 'Name it.',
        },
        {
          id: 'PRRT_3',
          path: 'README.md',
          line: null,
          body: '',
        },
      ],
      failingChecks: [
        'test',
        'ci/legacy',
      ],
    });

    expect(replay.nth(0).body).toMatchObject({
      variables: {
        owner: 'acme',
        name: 'app',
        number: 9,
      },
    });
  });

  it('returns no feedback for a pull request without checks or that cannot be read', async () => {
    const { host } = hostWith([
      feedbackRoute({
        reviewThreads: { nodes: [] },
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
      }),
    ]);

    expect(await host.getFeedback(
      'acme/app',
      9,
    )).toEqual({
      threads: [],
      failingChecks: [],
    });

    const missing = hostWith([feedbackRoute(null)]);

    expect(await missing.host.getFeedback(
      'acme/app',
      9,
    )).toEqual({
      threads: [],
      failingChecks: [],
    });
  });

  it('resolves a thread by its id', async () => {
    const {
      host,
      replay,
    } = hostWith([
      {
        method: 'POST',
        path: '/graphql',
        query: 'resolveReviewThread',
        body: { data: { resolveReviewThread: { thread: { id: 'PRRT_1' } } } },
      },
    ]);

    await host.resolveThread('PRRT_1');

    expect(replay.nth(0).body).toMatchObject({ variables: { id: 'PRRT_1' } });
  });
});

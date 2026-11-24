import type {
  Feedback,
  Issue,
  IssueComment,
  IssueRef,
  LabelActor,
  PullRequest,
  PullRequestDraft,
  RepoHostPort,
  RepositoryPermission,
  ReviewDraft,
} from '@boardwright/core';
import { parseReviewMarker } from '@boardwright/core';
import {
  isNotFound,
  isUnprocessable,
  splitRepository,
  type GitHubClient,
} from './client.ts';

const FEEDBACK_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { id isResolved path line comments(last: 1) { nodes { body } } }
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  ... on CheckRun { name conclusion }
                  ... on StatusContext { context state }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const RESOLVE_THREAD_MUTATION = `mutation($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) { thread { id } }
}`;

const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);

const FAILED_STATES: ReadonlySet<string> = new Set([
  'FAILURE',
  'ERROR',
]);

interface CheckContext {
  readonly name?: string;
  readonly conclusion?: string | null;
  readonly context?: string;
  readonly state?: string;
}

interface CheckRollup {
  readonly contexts: { readonly nodes: readonly CheckContext[] };
}

interface FeedbackQuery {
  readonly repository: {
    readonly pullRequest: {
      readonly reviewThreads: {
        readonly nodes: readonly {
          readonly id: string;
          readonly isResolved: boolean;
          readonly path: string;
          readonly line: number | null;
          readonly comments: { readonly nodes: readonly { readonly body: string }[] };
        }[];
      };
      readonly commits: {
        readonly nodes: readonly {
          readonly commit: { readonly statusCheckRollup: CheckRollup | null };
        }[];
      };
    } | null;
  } | null;
}

/** The name of a check run or a commit status that failed; nothing for one that passed or is running. */
function failingCheckName(context: CheckContext): string[] {
  if (
    context.name !== undefined
    && FAILED_CONCLUSIONS.has(context.conclusion ?? '')
  ) {
    return [context.name];
  }

  if (
    context.context !== undefined
    && FAILED_STATES.has(context.state ?? '')
  ) {
    return [context.context];
  }

  return [];
}

/** GitHub ids grow with time; padding keeps their string order equal to their creation order. */
const COMMENT_ID_WIDTH = 20;

const ROLE_PERMISSIONS: ReadonlySet<string> = new Set<RepositoryPermission>([
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
]);

/** Issues, comments, labels, files and pull requests through the GitHub REST API. */
export class GitHubRepoHost implements RepoHostPort {
  private readonly client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  /** The issue's title, body, label names and whether it is open. */
  async getIssue(ref: IssueRef): Promise<Issue> {
    const { data } = await this.client.rest.issues.get({
      ...splitRepository(ref.repository),
      issue_number: ref.number,
    });

    return {
      ref,
      title: data.title,
      body: data.body ?? '',
      labels: data.labels.map((label) => typeof label === 'string' ? label : label.name ?? ''),
      isOpen: data.state === 'open',
    };
  }

  /**
   * The person who most recently added the label, read from the issue's events, with their role.
   *
   * @remarks
   * The latest `labeled` event decides: if a stranger adds the label and a maintainer re-adds it, the
   * maintainer is who released the issue. Someone who is not a collaborator has no permission (`none`).
   */
  async findLabelActor(
    ref: IssueRef,
    label: string,
  ): Promise<LabelActor | undefined> {
    const repository = splitRepository(ref.repository);

    const events = await this.client.paginate(
      this.client.rest.issues.listEvents,
      {
        ...repository,
        issue_number: ref.number,
        per_page: 100,
      },
    );

    const login = events.findLast((event) => isLabeledWith(
      event,
      label,
    ))?.actor.login;

    if (login === undefined) {
      return undefined;
    }

    return {
      login,
      permission: await this.permissionOf(
        repository,
        login,
      ),
    };
  }

  /** Every comment of the issue, oldest first. */
  async listComments(ref: IssueRef): Promise<IssueComment[]> {
    const comments = await this.client.paginate(
      this.client.rest.issues.listComments,
      {
        ...splitRepository(ref.repository),
        issue_number: ref.number,
        per_page: 100,
      },
    );

    return comments.map((comment) => ({
      id: String(comment.id).padStart(
        COMMENT_ID_WIDTH,
        '0',
      ),
      body: comment.body ?? '',
      createdAt: new Date(comment.created_at),
    }));
  }

  /** Posts a comment on the issue. */
  async addComment(
    ref: IssueRef,
    body: string,
  ): Promise<void> {
    await this.client.rest.issues.createComment({
      ...splitRepository(ref.repository),
      issue_number: ref.number,
      body,
    });
  }

  /** The repository's default branch. */
  async getDefaultBranch(repository: string): Promise<string> {
    const { data } = await this.client.rest.repos.get(splitRepository(repository));

    return data.default_branch;
  }

  /** The open pull request whose head is `head` in the same repository. */
  async findOpenPullRequest(
    repository: string,
    head: string,
  ): Promise<PullRequest | undefined> {
    const name = splitRepository(repository);

    const { data } = await this.client.rest.pulls.list({
      ...name,
      state: 'open',
      head: `${name.owner}:${head}`,
      per_page: 1,
    });

    const [pullRequest] = data;

    return pullRequest === undefined ? undefined : {
      number: pullRequest.number,
      url: pullRequest.html_url,
      headSha: pullRequest.head.sha,
    };
  }

  /** Opens a pull request. */
  async openPullRequest(draft: PullRequestDraft): Promise<PullRequest> {
    const { data } = await this.client.rest.pulls.create({
      ...splitRepository(draft.repository),
      head: draft.head,
      base: draft.base,
      title: draft.title,
      body: draft.body,
    });

    return {
      number: data.number,
      url: data.html_url,
      headSha: data.head.sha,
    };
  }

  /**
   * The unresolved review threads and the failing checks of the head commit, in one GraphQL query.
   *
   * @remarks
   * Reads the first 100 threads and 100 checks; a pull request with more is beyond what one round fixes.
   * Checks still running are not failing yet.
   */
  async getFeedback(
    repository: string,
    number: number,
  ): Promise<Feedback> {
    const {
      owner,
      repo,
    } = splitRepository(repository);

    const data = await this.client.graphql<FeedbackQuery>(
      FEEDBACK_QUERY,
      {
        owner,
        name: repo,
        number,
      },
    );

    const pullRequest = data.repository?.pullRequest;
    const contexts = pullRequest?.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];

    return {
      threads: (pullRequest?.reviewThreads.nodes ?? [])
        .filter((thread) => !thread.isResolved)
        .map((thread) => ({
          id: thread.id,
          path: thread.path,
          line: thread.line,
          body: thread.comments.nodes[0]?.body ?? '',
        })),
      failingChecks: contexts.flatMap((context) => failingCheckName(context)),
    };
  }

  /** Marks a review thread resolved. */
  async resolveThread(threadId: string): Promise<void> {
    await this.client.graphql(
      RESOLVE_THREAD_MUTATION,
      { id: threadId },
    );
  }

  /** Whether a review carrying the pipeline's marker was posted for this head commit. */
  async hasAgentReview(
    repository: string,
    number: number,
    headSha: string,
  ): Promise<boolean> {
    const reviews = await this.client.paginate(
      this.client.rest.pulls.listReviews,
      {
        ...splitRepository(repository),
        pull_number: number,
        per_page: 100,
      },
    );

    return reviews.some((review) => review.commit_id === headSha
      && parseReviewMarker(review.body)?.headSha === headSha);
  }

  /**
   * Posts a review that only comments, with its line comments.
   *
   * @remarks
   * GitHub rejects the whole review (422) when one comment points at a line outside the diff; the review is
   * then posted again with the comments in its body, so no finding is lost.
   */
  async submitReview(review: ReviewDraft): Promise<void> {
    const target = {
      ...splitRepository(review.repository),
      pull_number: review.number,
      commit_id: review.headSha,
      event: 'COMMENT' as const,
    };

    try {
      await this.client.rest.pulls.createReview({
        ...target,
        body: review.body,
        comments: review.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: 'RIGHT' as const,
          body: comment.body,
        })),
      });
    } catch (error) {
      if (
        !isUnprocessable(error)
        || review.comments.length === 0
      ) {
        throw error;
      }

      await this.client.rest.pulls.createReview({
        ...target,
        body: [
          review.body,
          '',
          '**Line comments** (GitHub could not place them on the diff):',
          '',
          ...review.comments.map((comment) => `- \`${comment.path}:${comment.line}\` ${comment.body}`),
        ].join('\n'),
      });
    }
  }

  /** Whether the repository has a label with this exact name. */
  async hasLabel(
    repository: string,
    label: string,
  ): Promise<boolean> {
    try {
      await this.client.rest.issues.getLabel({
        ...splitRepository(repository),
        name: label,
      });

      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }

      throw error;
    }
  }

  /** A file on the default branch, as text; `undefined` when it does not exist or is a directory. */
  async readFile(
    repository: string,
    path: string,
  ): Promise<string | undefined> {
    try {
      const { data } = await this.client.rest.repos.getContent({
        ...splitRepository(repository),
        path,
        mediaType: { format: 'raw' },
      });

      return typeof data === 'string' ? data : undefined;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }

      throw error;
    }
  }

  /** The names in a directory on the default branch, sorted; empty when it does not exist. */
  async listDirectory(
    repository: string,
    path: string,
  ): Promise<string[]> {
    try {
      const { data } = await this.client.rest.repos.getContent({
        ...splitRepository(repository),
        path,
      });

      return Array.isArray(data) ? data.map((entry) => entry.name).sort((
        left,
        right,
      ) => left.localeCompare(right)) : [];
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }

      throw error;
    }
  }

  private async permissionOf(
    repository: {
      owner: string;
      repo: string;
    },
    username: string,
  ): Promise<RepositoryPermission> {
    try {
      const { data } = await this.client.rest.repos.getCollaboratorPermissionLevel({
        ...repository,
        username,
      });

      return toPermission(data.role_name) ?? toPermission(data.permission) ?? 'none';
    } catch (error) {
      if (isNotFound(error)) {
        return 'none';
      }

      throw error;
    }
  }
}

function toPermission(value: string | undefined): RepositoryPermission | undefined {
  return value !== undefined && ROLE_PERMISSIONS.has(value) ? value as RepositoryPermission : undefined;
}

function isLabeledWith(
  event: object,
  label: string,
): boolean {
  return 'event' in event
    && event.event === 'labeled'
    && 'label' in event
    && typeof event.label === 'object'
    && event.label !== null
    && 'name' in event.label
    && event.label.name === label;
}

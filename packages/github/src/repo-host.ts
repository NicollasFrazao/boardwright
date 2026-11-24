import type {
  Issue,
  IssueComment,
  IssueRef,
  LabelActor,
  PullRequest,
  PullRequestDraft,
  RepoHostPort,
  RepositoryPermission,
} from '@boardwright/core';
import {
  isNotFound,
  splitRepository,
  type GitHubClient,
} from './client.ts';

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
    };
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

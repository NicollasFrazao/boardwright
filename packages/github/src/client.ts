import { Octokit } from '@octokit/rest';

const HTTP_NOT_FOUND = 404;

const QUIET_LOG = {
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

/** How to reach GitHub. */
export interface GitHubClientOptions {
  readonly token: string;

  /** Replaces the global `fetch`; tests pass a replay. */
  readonly fetch?: typeof fetch;
}

/** The Octokit client the adapters share. */
export type GitHubClient = Octokit;

/** A client authenticated with `token`. The token is held by Octokit and never logged. */
export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  return new Octokit({
    auth: options.token,
    userAgent: 'boardwright',
    // The adapters turn expected 404s into answers and rethrow the rest; Octokit's own request log
    // would print every 404 to the terminal.
    log: QUIET_LOG,
    request: options.fetch === undefined ? {} : { fetch: options.fetch },
  });
}

/** Splits `owner/name`. */
export function splitRepository(repository: string): {
  owner: string;
  repo: string;
} {
  const [
    owner = '',
    repo = '',
  ] = repository.split('/');

  return {
    owner,
    repo,
  };
}

/** Whether an Octokit error is a 404. */
export function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === HTTP_NOT_FOUND;
}

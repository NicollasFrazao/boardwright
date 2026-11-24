import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  Workspace,
  WorkspacePort,
  WorkspaceRequest,
} from '@boardwright/core';

const run = promisify(execFile);

/** Enough for a large diff listing; git output beyond it would fail loudly rather than be cut. */
const MAX_OUTPUT_BYTES = 16_777_216;

/** Enough of a random id to keep two worktrees of the same branch apart. */
const WORKTREE_SUFFIX_LENGTH = 8;

/** `XY ` before the path in `git status --porcelain`. */
const STATUS_PREFIX_LENGTH = 3;

/** The person agent commits are attributed to, when the machine's git config has none. */
export interface GitAuthor {
  readonly name: string;
  readonly email: string;
}

/** How the workspaces reach the repositories and where they keep their clones. */
export interface GitWorkspacesOptions {
  /** Holds `repositories/` (one clone per repository) and `worktrees/` (one per run). */
  readonly directory: string;

  /** The clone URL of a repository; for GitHub, `https://github.com/<owner/name>.git`. */
  readonly remoteUrl: (repository: string) => string;

  /** A token for HTTPS remotes; it is passed to the runner's own git commands only. */
  readonly token: string | undefined;
  readonly author: GitAuthor | undefined;
}

/**
 * Workspaces on the git CLI: a cached clone per repository and a fresh worktree per run.
 *
 * @remarks
 * The token never reaches `.git/config`: it is given to `clone`, `fetch` and `push` through the
 * `GIT_CONFIG_*` environment of those commands. An agent working in the worktree therefore cannot read
 * it, and its own `git push` has no credentials.
 */
export class GitWorkspaces implements WorkspacePort {
  private readonly options: GitWorkspacesOptions;

  constructor(options: GitWorkspacesOptions) {
    this.options = options;
  }

  /** Fetches the clone, then adds a worktree on the branch: from the remote branch if it exists, else from `base`. */
  async prepare(request: WorkspaceRequest): Promise<Workspace> {
    const clone = await this.cloneOf(request.repository);
    const remoteBranch = `origin/${request.branch}`;

    const startPoint = await this.git(
      clone,
      [
        'rev-parse',
        '--verify',
        '--quiet',
        remoteBranch,
      ],
    ).then(
      () => remoteBranch,
      () => `origin/${request.base}`,
    );

    const path = join(
      this.options.directory,
      'worktrees',
      `${slug(request.repository)}__${slug(request.branch)}__${randomUUID().slice(
        0,
        WORKTREE_SUFFIX_LENGTH,
      )}`,
    );

    await this.releaseBranch(
      clone,
      request.branch,
    );

    await this.git(
      clone,
      [
        'worktree',
        'add',
        '--force',
        '-B',
        request.branch,
        path,
        startPoint,
      ],
    );

    const startSha = (await this.git(
      path,
      [
        'rev-parse',
        'HEAD',
      ],
    )).trim();

    return {
      ...request,
      path,
      startSha,
    };
  }

  /** Paths changed against `base`: committed on the branch, staged, unstaged or untracked. */
  async changedPaths(workspace: Workspace): Promise<string[]> {
    const committed = await this.git(
      workspace.path,
      [
        'diff',
        '--name-only',
        `origin/${workspace.base}...HEAD`,
      ],
    );

    const pending = await this.git(
      workspace.path,
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '-z',
      ],
    );

    const paths = new Set([
      ...lines(committed),
      ...pendingPaths(pending),
    ]);

    return [...paths].sort((
      left,
      right,
    ) => left.localeCompare(right));
  }

  /** Whether the run committed anything after the worktree's starting commit. */
  async hasCommits(workspace: Workspace): Promise<boolean> {
    const count = await this.git(
      workspace.path,
      [
        'rev-list',
        '--count',
        `${workspace.startSha}..HEAD`,
      ],
    );

    return Number(count.trim()) > 0;
  }

  /** Pushes the branch to `origin` without force; a rejected push fails the run instead of overwriting. */
  async push(workspace: Workspace): Promise<void> {
    await this.git(
      workspace.path,
      [
        'push',
        'origin',
        `HEAD:refs/heads/${workspace.branch}`,
      ],
      { authenticated: true },
    );
  }

  /** Removes the worktree and its local branch. */
  async dispose(workspace: Workspace): Promise<void> {
    const clone = this.clonePath(workspace.repository);

    await this.git(
      clone,
      [
        'worktree',
        'remove',
        '--force',
        workspace.path,
      ],
    ).catch(() => rm(
      workspace.path,
      {
        recursive: true,
        force: true,
      },
    ));

    await this.git(
      clone,
      [
        'worktree',
        'prune',
      ],
    );

    await this.git(
      clone,
      [
        'branch',
        '-D',
        workspace.branch,
      ],
    ).catch(() => undefined);
  }

  /**
   * Removes worktrees left on the branch by a run that died before disposing them.
   *
   * @remarks
   * The claim gives an item to one run at a time, so another worktree on the branch is never live.
   */
  private async releaseBranch(
    clone: string,
    branch: string,
  ): Promise<void> {
    await this.git(
      clone,
      [
        'worktree',
        'prune',
      ],
    );

    const listing = await this.git(
      clone,
      [
        'worktree',
        'list',
        '--porcelain',
      ],
    );

    const stale = listing.split('\n\n')
      .filter((block) => block.split('\n').includes(`branch refs/heads/${branch}`))
      .map((block) => block.split('\n')[0]?.replace(
        /^worktree /u,
        '',
      ) ?? '');

    for (const path of stale.filter((entry) => entry !== '')) {
      await this.git(
        clone,
        [
          'worktree',
          'remove',
          '--force',
          path,
        ],
      );
    }
  }

  private clonePath(repository: string): string {
    return join(
      this.options.directory,
      'repositories',
      slug(repository),
    );
  }

  private async cloneOf(repository: string): Promise<string> {
    const clone = this.clonePath(repository);

    const exists = await this.git(
      clone,
      [
        'rev-parse',
        '--git-dir',
      ],
    ).then(
      () => true,
      () => false,
    );

    if (exists) {
      await this.git(
        clone,
        [
          'fetch',
          '--prune',
          'origin',
        ],
        { authenticated: true },
      );
    } else {
      await mkdir(
        join(
          this.options.directory,
          'repositories',
        ),
        { recursive: true },
      );

      await this.git(
        this.options.directory,
        [
          'clone',
          '--no-tags',
          this.options.remoteUrl(repository),
          clone,
        ],
        { authenticated: true },
      );
    }

    if (this.options.author !== undefined) {
      await this.git(
        clone,
        [
          'config',
          'user.name',
          this.options.author.name,
        ],
      );

      await this.git(
        clone,
        [
          'config',
          'user.email',
          this.options.author.email,
        ],
      );
    }

    return clone;
  }

  private async git(
    cwd: string,
    args: readonly string[],
    options: { authenticated: boolean } = { authenticated: false },
  ): Promise<string> {
    const { stdout } = await run(
      'git',
      [...args],
      {
        cwd,
        env: {
          ...process.env,
          ...options.authenticated ? this.credentials() : {},
          GIT_TERMINAL_PROMPT: '0',
        },
        maxBuffer: MAX_OUTPUT_BYTES,
      },
    );

    return stdout;
  }

  private credentials(): Record<string, string> {
    if (this.options.token === undefined) {
      return {};
    }

    const basic = Buffer.from(`x-access-token:${this.options.token}`).toString('base64');

    return {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    };
  }
}

/** A path-safe name for `owner/name` or a branch. */
function slug(text: string): string {
  return text.replaceAll(
    /[^\w.-]+/gu,
    '__',
  );
}

/**
 * The paths in `git status --porcelain -z`. A rename or a copy is followed by an extra entry with the
 * original path and no status; both paths count, so moving a denied file away is caught too.
 */
function pendingPaths(output: string): string[] {
  const entries = output.split('\0');
  const paths: string[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';

    if (entry.length > STATUS_PREFIX_LENGTH) {
      paths.push(entry.slice(STATUS_PREFIX_LENGTH));

      if (/^[RC]/u.test(entry)) {
        index += 1;
        paths.push(entries[index] ?? '');
      }
    }
  }

  return paths.filter((path) => path !== '');
}

function lines(output: string): string[] {
  return output.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

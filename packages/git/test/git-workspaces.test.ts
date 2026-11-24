import { execFile } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { GitWorkspaces } from '../src/index.ts';

const run = promisify(execFile);

const AUTHOR = {
  name: 'boardwright test',
  email: 'test@example.com',
};

async function git(
  cwd: string,
  ...args: string[]
): Promise<string> {
  const { stdout } = await run(
    'git',
    [
      '-c',
      `user.name=${AUTHOR.name}`,
      '-c',
      `user.email=${AUTHOR.email}`,
      ...args,
    ],
    { cwd },
  );

  return stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

let root: string;
let remote: string;
let workspaces: GitWorkspaces;

const request = {
  repository: 'acme/app',
  branch: 'agent/issue-7',
  base: 'master',
};

beforeEach(async () => {
  root = await mkdtemp(join(
    tmpdir(),
    'boardwright-git-',
  ));

  remote = join(
    root,
    'remote.git',
  );

  const seed = join(
    root,
    'seed',
  );

  await git(
    root,
    'init',
    '--bare',
    '-b',
    'master',
    remote,
  );

  await git(
    root,
    'init',
    '-b',
    'master',
    seed,
  );

  await mkdir(
    join(
      seed,
      '.github',
      'workflows',
    ),
    { recursive: true },
  );

  await writeFile(
    join(
      seed,
      'README.md',
    ),
    '# app\n',
  );

  await writeFile(
    join(
      seed,
      '.github',
      'workflows',
      'ci.yml',
    ),
    'name: CI\n',
  );

  await git(
    seed,
    'add',
    '.',
  );

  await git(
    seed,
    'commit',
    '-m',
    'init',
  );

  await git(
    seed,
    'push',
    remote,
    'master',
  );

  workspaces = new GitWorkspaces({
    directory: join(
      root,
      'cache',
    ),
    remoteUrl: () => remote,
    token: 'secret-token',
    author: AUTHOR,
  });
});

afterEach(async () => {
  await rm(
    root,
    {
      recursive: true,
      force: true,
    },
  );
});

describe('GitWorkspaces', () => {
  it('prepares a worktree on a new branch from base, with nothing changed yet', async () => {
    const workspace = await workspaces.prepare(request);

    expect(await git(
      workspace.path,
      'branch',
      '--show-current',
    )).toBe('agent/issue-7');

    expect(await readFile(
      join(
        workspace.path,
        'README.md',
      ),
      'utf8',
    )).toBe('# app\n');

    expect(await workspaces.changedPaths(workspace)).toEqual([]);
    expect(await workspaces.hasCommits(workspace)).toBe(false);
  });

  it('sees committed, modified, untracked and renamed paths, both sides of a rename included', async () => {
    const workspace = await workspaces.prepare(request);

    await writeFile(
      join(
        workspace.path,
        'feature.ts',
      ),
      'export {};\n',
    );

    await git(
      workspace.path,
      'add',
      'feature.ts',
    );

    await git(
      workspace.path,
      'commit',
      '-m',
      'feat: add the feature',
    );

    await writeFile(
      join(
        workspace.path,
        'README.md',
      ),
      '# app, changed\n',
    );

    await writeFile(
      join(
        workspace.path,
        'notes.txt',
      ),
      'untracked\n',
    );

    await git(
      workspace.path,
      'mv',
      '.github/workflows/ci.yml',
      'ci.yml',
    );

    expect(await workspaces.changedPaths(workspace)).toEqual([
      '.github/workflows/ci.yml',
      'ci.yml',
      'feature.ts',
      'notes.txt',
      'README.md',
    ]);

    expect(await workspaces.hasCommits(workspace)).toBe(true);
  });

  it('pushes the branch, and a later run continues it', async () => {
    const first = await workspaces.prepare(request);

    await writeFile(
      join(
        first.path,
        'feature.ts',
      ),
      'export {};\n',
    );

    await git(
      first.path,
      'add',
      '.',
    );

    await git(
      first.path,
      'commit',
      '-m',
      'feat: add the feature',
    );

    await workspaces.push(first);
    await workspaces.dispose(first);

    expect(await git(
      remote,
      'log',
      '--format=%s',
      'agent/issue-7',
    )).toBe('feat: add the feature\ninit');

    const second = await workspaces.prepare(request);

    expect(await readFile(
      join(
        second.path,
        'feature.ts',
      ),
      'utf8',
    )).toBe('export {};\n');
  });

  it('never forces: a push onto a branch someone else moved on is rejected', async () => {
    const workspace = await workspaces.prepare(request);

    await writeFile(
      join(
        workspace.path,
        'a.ts',
      ),
      'a\n',
    );

    await git(
      workspace.path,
      'add',
      '.',
    );

    await git(
      workspace.path,
      'commit',
      '-m',
      'a',
    );

    await workspaces.push(workspace);

    const other = join(
      root,
      'other',
    );

    await git(
      root,
      'clone',
      '-b',
      'agent/issue-7',
      remote,
      other,
    );

    await writeFile(
      join(
        other,
        'b.ts',
      ),
      'b\n',
    );

    await git(
      other,
      'add',
      '.',
    );

    await git(
      other,
      'commit',
      '-m',
      'b',
    );

    await git(
      other,
      'push',
      'origin',
      'agent/issue-7',
    );

    await git(
      workspace.path,
      'commit',
      '--amend',
      '-m',
      'a, rewritten',
    );

    await expect(workspaces.push(workspace)).rejects.toThrow(/rejected|non-fast-forward|fetch first/u);

    expect(await git(
      remote,
      'log',
      '--format=%s',
      'agent/issue-7',
    )).toBe('b\na\ninit');
  });

  it('takes over a branch left in a worktree by a run that died', async () => {
    const dead = await workspaces.prepare(request);
    const next = await workspaces.prepare(request);

    expect(await exists(dead.path)).toBe(false);

    expect(await git(
      next.path,
      'branch',
      '--show-current',
    )).toBe('agent/issue-7');
  });

  it('removes the worktree and its local branch', async () => {
    const workspace = await workspaces.prepare(request);

    await workspaces.dispose(workspace);

    expect(await exists(workspace.path)).toBe(false);

    expect(await git(
      join(
        root,
        'cache',
        'repositories',
        'acme__app',
      ),
      'branch',
      '--list',
      'agent/issue-7',
    )).toBe('');
  });

  it('keeps the token out of every git config an agent could read, and sets the author', async () => {
    const workspace = await workspaces.prepare(request);

    const config = await git(
      workspace.path,
      'config',
      '--list',
      '--show-origin',
    );

    expect(config).not.toContain('secret-token');
    expect(config).not.toContain(Buffer.from('x-access-token:secret-token').toString('base64'));

    expect(await git(
      workspace.path,
      'config',
      'user.email',
    )).toBe('test@example.com');
  });

  it('works without a token or an author', async () => {
    const plain = new GitWorkspaces({
      directory: join(
        root,
        'plain-cache',
      ),
      remoteUrl: () => remote,
      token: undefined,
      author: undefined,
    });

    const workspace = await plain.prepare(request);

    expect(await workspaces.changedPaths(workspace)).toEqual([]);
    await plain.dispose(workspace);
  });
});

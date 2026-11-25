import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  acquireFileLock,
  isProcessAlive,
} from '../src/lock.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(
    tmpdir(),
    'boardwright-lock-',
  ));
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

describe('acquireFileLock', () => {
  it('takes a free lock, writes the process id, and frees it on release', async () => {
    const path = join(
      root,
      'locks',
      'acme-3.lock',
    );

    const release = await acquireFileLock(
      path,
      4242,
      () => true,
    );

    expect(release).toBeDefined();

    expect(await readFile(
      path,
      'utf8',
    )).toBe('4242');

    await release?.();

    expect(await stat(path).then(
      () => true,
      () => false,
    )).toBe(false);
  });

  it('refuses a lock a live process holds', async () => {
    const path = join(
      root,
      'acme-3.lock',
    );

    await writeFile(
      path,
      '1111',
    );

    expect(await acquireFileLock(
      path,
      4242,
      () => true,
    )).toBeUndefined();

    expect(await readFile(
      path,
      'utf8',
    )).toBe('1111');
  });

  it('takes over a lock left by a process that died, or that holds no process id', async () => {
    const path = join(
      root,
      'acme-3.lock',
    );

    await writeFile(
      path,
      '1111',
    );

    expect(await acquireFileLock(
      path,
      4242,
      () => false,
    )).toBeDefined();

    expect(await readFile(
      path,
      'utf8',
    )).toBe('4242');

    await writeFile(
      path,
      'garbage',
    );

    expect(await acquireFileLock(
      path,
      4343,
      () => true,
    )).toBeDefined();
  });
});

describe('isProcessAlive', () => {
  it('knows this process is alive and an unused id is not', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2_147_483_646)).toBe(false);
  });
});

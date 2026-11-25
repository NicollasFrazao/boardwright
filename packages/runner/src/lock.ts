import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';

/** Whether a process is alive; `kill(pid, 0)` sends no signal, it only checks. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(
      pid,
      0,
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Takes a lock file holding this process's id; resolves its release, or `undefined` when a live process
 * holds it.
 *
 * @remarks
 * A lock left by a process that died is taken over, so a crash never blocks the next runner.
 */
export async function acquireFileLock(
  path: string,
  pid: number = process.pid,
  isAlive: (pid: number) => boolean = isProcessAlive,
): Promise<(() => Promise<void>) | undefined> {
  await mkdir(
    dirname(path),
    { recursive: true },
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await create(
      path,
      pid,
    )) {
      return () => rm(
        path,
        { force: true },
      );
    }

    const holder = Number(await readFile(
      path,
      'utf8',
    ).catch(() => ''));

    if (
      Number.isInteger(holder)
      && holder > 0
      && isAlive(holder)
    ) {
      return undefined;
    }

    await rm(
      path,
      { force: true },
    );
  }

  return undefined;
}

async function create(
  path: string,
  pid: number,
): Promise<boolean> {
  try {
    await writeFile(
      path,
      String(pid),
      { flag: 'wx' },
    );

    return true;
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'EEXIST'
    ) {
      return false;
    }

    throw error;
  }
}

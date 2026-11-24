import {
  access,
  readdir,
  readFile,
} from 'node:fs/promises';
import { join } from 'node:path';

/** Whether a path exists under `root`. */
export async function exists(
  root: string,
  relativePath: string,
): Promise<boolean> {
  try {
    await access(join(
      root,
      relativePath,
    ));

    return true;
  } catch {
    return false;
  }
}

/** The names in a directory under `root`, sorted; empty when the directory does not exist. */
export async function listNames(
  root: string,
  relativePath: string,
): Promise<string[]> {
  try {
    const entries = await readdir(join(
      root,
      relativePath,
    ));

    return entries.sort((
      left,
      right,
    ) => left.localeCompare(right));
  } catch {
    return [];
  }
}

/** A UTF-8 file under `root`. */
export function readText(
  root: string,
  relativePath: string,
): Promise<string> {
  return readFile(
    join(
      root,
      relativePath,
    ),
    'utf8',
  );
}

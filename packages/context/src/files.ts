import {
  access,
  readdir,
  readFile,
} from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where a provider reads a repository's files: a local checkout, or the repository through its host's API.
 *
 * @remarks
 * `root` is what locates the repository in the source: a directory for a checkout, `owner/name` for an API.
 */
export interface FileSource {
  exists(root: string, path: string): Promise<boolean>;

  /** The names in a directory, sorted; empty when it does not exist. */
  listNames(root: string, path: string): Promise<string[]>;

  /** A UTF-8 file; `undefined` when it does not exist. */
  readText(root: string, path: string): Promise<string | undefined>;
}

/** Files of a local checkout, `root` being its directory. */
export const localFiles: FileSource = {
  async exists(
    root,
    path,
  ) {
    try {
      await access(join(
        root,
        path,
      ));

      return true;
    } catch {
      return false;
    }
  },

  async listNames(
    root,
    path,
  ) {
    try {
      const names = await readdir(join(
        root,
        path,
      ));

      return names.sort((
        left,
        right,
      ) => left.localeCompare(right));
    } catch {
      return [];
    }
  },

  async readText(
    root,
    path,
  ) {
    try {
      return await readFile(
        join(
          root,
          path,
        ),
        'utf8',
      );
    } catch {
      return undefined;
    }
  },
};

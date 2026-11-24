import type { FileSource } from '@boardwright/context';
import type { RepoHostPort } from '@boardwright/core';

/**
 * A repository's files on its default branch, read through the host's API, `root` being `owner/name`.
 *
 * @remarks
 * `doctor` checks each repository's context base this way, without cloning anything.
 */
export function repositoryFiles(repoHost: RepoHostPort): FileSource {
  return {
    async exists(
      repository,
      path,
    ) {
      return await repoHost.readFile(
        repository,
        path,
      ) !== undefined
        || (await repoHost.listDirectory(
          repository,
          path,
        )).length > 0;
    },

    listNames: (
      repository,
      path,
    ) => repoHost.listDirectory(
      repository,
      path,
    ),

    readText: (
      repository,
      path,
    ) => repoHost.readFile(
      repository,
      path,
    ),
  };
}

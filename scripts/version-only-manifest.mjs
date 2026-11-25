import { readFileSync } from 'node:fs';

/**
 * An esbuild plugin that loads one package.json as `{ version }` only. The CLI imports the root manifest
 * to print `--version`; without this, the bundle would carry all of it (scripts, devDependencies).
 *
 * @param {string} path The absolute path of the manifest to reduce; any other file loads as usual.
 * @returns {import('esbuild').Plugin}
 */
export function versionOnlyManifest(path) {
  return {
    name: 'version-only-manifest',
    setup(build) {
      build.onLoad({ filter: /package\.json$/ }, (args) => {
        if (args.path !== path) {
          return undefined;
        }

        const { version } = JSON.parse(readFileSync(path, 'utf8'));

        return { contents: JSON.stringify({ version }), loader: 'json' };
      });
    },
  };
}

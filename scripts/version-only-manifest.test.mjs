import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { versionOnlyManifest } from './version-only-manifest.mjs';

let directory;

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** The plugin's load callback, as esbuild would register it. */
function loader(path) {
  let callback;

  versionOnlyManifest(path).setup({
    onLoad(_options, registered) {
      callback = registered;
    },
  });

  return callback;
}

describe('versionOnlyManifest', () => {
  it('loads the given manifest as its version only, and leaves every other package.json alone', () => {
    directory = mkdtempSync(join(tmpdir(), 'boardwright-manifest-'));
    const path = join(directory, 'package.json');

    writeFileSync(path, JSON.stringify({ name: 'root', version: '1.2.3', scripts: { test: 'vitest' }, devDependencies: { vitest: '1' } }));

    const load = loader(path);

    expect(load({ path })).toEqual({ contents: '{"version":"1.2.3"}', loader: 'json' });
    expect(load({ path: join(directory, 'node_modules', 'zod', 'package.json') })).toBeUndefined();
  });
});

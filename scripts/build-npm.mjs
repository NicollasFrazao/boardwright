#!/usr/bin/env node
/**
 * Writes the `boardwright` npm package into build/npm (npm run build:npm), from the committed CLI bundle
 * in dist/. The release workflow publishes that directory; `npm pack build/npm` shows what it holds.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmManifest, PACKAGE_FILES } from './npm-package.mjs';

const OUT = join('build', 'npm');

const SOURCES = {
  'cli.js': join('dist', 'cli.js'),
  'README.md': 'README.md',
  LICENSE: 'LICENSE',
  'THIRD_PARTY_LICENSES.txt': join('dist', 'THIRD_PARTY_LICENSES.txt'),
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const file of PACKAGE_FILES) {
  copyFileSync(SOURCES[file], join(OUT, file));
}

const manifest = npmManifest(readJson('package.json'), readJson('package-lock.json'));

writeFileSync(join(OUT, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

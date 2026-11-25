#!/usr/bin/env node
/**
 * Builds the GitHub Action into dist/ (npm run build:action): the entry (index.js), the CLI it runs
 * (cli.js), the licenses of what they bundle, and agent-packages.json, the SDK packages to install at
 * run time. dist/ is committed, because an Action runs from the repository as it is; CI rebuilds it and
 * fails when the result differs from what was committed.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { AGENT_SDK, pinnedAgentPackages } from './agent-packages.mjs';
import { bundledPackages } from './bundled-packages.mjs';

const OUT = 'dist';
const LICENSE_RULE_LENGTH = 72;

mkdirSync(OUT, { recursive: true });

// Everything but the packages a previous run installed, so a stale file never survives a rebuild.
for (const name of readdirSync(OUT, { withFileTypes: true })) {
  if (name.name !== 'node_modules') {
    rmSync(join(OUT, name.name), { recursive: true, force: true });
  }
}

const { metafile } = await build({
  entryPoints: {
    index: 'packages/runner/src/action.ts',
    cli: 'packages/runner/src/cli.ts',
  },
  outdir: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // The runtime of `runs.using: node24`; the newest Node an Action can name.
  target: 'node24',
  external: [AGENT_SDK],
  // The licenses go to one file, with every bundled package's full text (below).
  legalComments: 'none',
  metafile: true,
  // Bundled CommonJS modules call require(); an ES module has none of its own.
  banner: { js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});

writeFileSync(join(OUT, 'THIRD_PARTY_LICENSES.txt'), thirdPartyLicenses(Object.keys(metafile.inputs)));

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

writeFileSync(join(OUT, 'agent-packages.json'), `${JSON.stringify(pinnedAgentPackages(lock), null, 2)}\n`);

/** The license of every npm package in the bundle, as each package ships it. */
function thirdPartyLicenses(inputs) {
  return bundledPackages(inputs).map((directory) => {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const file = readdirSync(directory).find((name) => /^(licen[cs]e|copying)/iu.test(name));
    const text = file === undefined ? `License: ${manifest.license}` : readFileSync(join(directory, file), 'utf8').trim();

    return `${manifest.name}@${manifest.version}\n\n${text}\n`;
  }).join(`\n${'-'.repeat(LICENSE_RULE_LENGTH)}\n\n`);
}

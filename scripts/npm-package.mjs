/**
 * The package.json of the `boardwright` npm package: the CLI bundled in dist/cli.js, with the Claude
 * Agent SDK as its one dependency, at the version package-lock.json pins. The monorepo's workspaces stay
 * private; this is the only package published.
 */

/** The published package's name. */
export const PACKAGE_NAME = 'boardwright';

/** The files the package carries, next to its package.json. */
export const PACKAGE_FILES = ['cli.js', 'README.md', 'LICENSE', 'THIRD_PARTY_LICENSES.txt'];

/** The manifest, from the root package.json (version, description, license) and the lockfile. */
export function npmManifest(root, lock) {
  const sdk = lock.packages?.['node_modules/@anthropic-ai/claude-agent-sdk']?.version;

  if (typeof sdk !== 'string') {
    throw new Error('package-lock.json does not pin @anthropic-ai/claude-agent-sdk.');
  }

  return {
    name: PACKAGE_NAME,
    version: root.version,
    description: root.description,
    keywords: ['github-projects', 'agents', 'claude', 'pipeline', 'automation'],
    homepage: 'https://github.com/NicollasFrazao/boardwright#readme',
    bugs: 'https://github.com/NicollasFrazao/boardwright/issues',
    repository: {
      type: 'git',
      url: 'git+https://github.com/NicollasFrazao/boardwright.git',
    },
    license: root.license,
    author: root.author,
    type: 'module',
    bin: { [PACKAGE_NAME]: 'cli.js' },
    files: PACKAGE_FILES.filter((file) => file !== 'README.md' && file !== 'LICENSE'),
    // The bundle targets Node 24, the runtime of the Action; the repository itself develops on Node 26.
    engines: { node: '>=24' },
    dependencies: { '@anthropic-ai/claude-agent-sdk': sdk },
  };
}

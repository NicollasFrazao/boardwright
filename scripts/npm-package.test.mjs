import { describe, expect, it } from 'vitest';
import { npmManifest, PACKAGE_FILES } from './npm-package.mjs';

const ROOT = { version: '0.1.0', description: 'Pipelines.', license: 'MIT', author: 'Someone' };

const LOCK = { packages: { 'node_modules/@anthropic-ai/claude-agent-sdk': { version: '0.3.331' } } };

describe('npmManifest', () => {
  it('publishes the bundled CLI with the pinned SDK as its only dependency', () => {
    expect(npmManifest(ROOT, LOCK)).toMatchObject({
      name: 'boardwright',
      version: '0.1.0',
      license: 'MIT',
      type: 'module',
      bin: { boardwright: 'cli.js' },
      files: ['cli.js', 'THIRD_PARTY_LICENSES.txt'],
      engines: { node: '>=24' },
      dependencies: { '@anthropic-ai/claude-agent-sdk': '0.3.331' },
    });
  });

  it('copies README and LICENSE, which npm includes without listing them', () => {
    expect(PACKAGE_FILES).toEqual(['cli.js', 'README.md', 'LICENSE', 'THIRD_PARTY_LICENSES.txt']);
  });

  it('refuses a lockfile without the SDK', () => {
    expect(() => npmManifest(ROOT, { packages: {} })).toThrow('does not pin');
  });
});

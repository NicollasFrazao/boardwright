import { describe, expect, it } from 'vitest';
import { bundledPackages } from './bundled-packages.mjs';

describe('bundledPackages', () => {
  it('lists each package directory once, scoped or not, and skips the sources', () => {
    expect(bundledPackages([
      'packages/core/src/index.ts',
      'node_modules/zod/v4/core/core.js',
      'node_modules/zod/v4/classic/schemas.js',
      'node_modules/@octokit/rest/dist-src/index.js',
      'node_modules/@octokit/core/node_modules/before-after-hook/index.js',
    ])).toEqual([
      'node_modules/@octokit/core/node_modules/before-after-hook',
      'node_modules/@octokit/rest',
      'node_modules/zod',
    ]);
  });
});

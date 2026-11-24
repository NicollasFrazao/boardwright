import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  canTriage,
  DEFAULT_DENIED_PATHS,
  findDeniedPaths,
  isAllowedRepository,
} from '../src/index.ts';

describe('canTriage', () => {
  it.each([
    [
      'none',
      false,
    ],
    [
      'read',
      false,
    ],
    [
      'triage',
      true,
    ],
    [
      'write',
      true,
    ],
    [
      'maintain',
      true,
    ],
    [
      'admin',
      true,
    ],
  ] as const)('%s → %s', (
    permission,
    expected,
  ) => {
    expect(canTriage(permission)).toBe(expected);
  });
});

describe('isAllowedRepository', () => {
  it('matches owner/name ignoring case', () => {
    expect(isAllowedRepository(
      'Acme/App',
      ['acme/app'],
    )).toBe(true);
  });

  it('rejects a repository outside the list', () => {
    expect(isAllowedRepository(
      'acme/other',
      ['acme/app'],
    )).toBe(false);
  });
});

describe('findDeniedPaths with the default denylist', () => {
  it.each([
    '.github/workflows/ci.yml',
    '.github/workflows/nested/release.yml',
    '.env',
    'apps/api/.env',
    'apps/api/.env.production',
    'certs/server.pem',
    'deploy/id.key',
  ])('denies %s', (path) => {
    expect(findDeniedPaths(
      [path],
      DEFAULT_DENIED_PATHS,
    )).toEqual([path]);
  });

  it.each([
    'src/index.ts',
    '.github/dependabot.yml',
    '.github/pull_request_template.md',
    'docs/environment.md',
  ])('allows %s', (path) => {
    expect(findDeniedPaths(
      [path],
      DEFAULT_DENIED_PATHS,
    )).toEqual([]);
  });
});

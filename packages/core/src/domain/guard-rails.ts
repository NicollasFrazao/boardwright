import { posix } from 'node:path';

/** A person's permission on a repository, as GitHub reports it. */
export type RepositoryPermission = 'none' | 'read' | 'triage' | 'write' | 'maintain' | 'admin';

const PERMISSION_ORDER: readonly RepositoryPermission[] = [
  'none',
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
];

/**
 * Whether a permission includes triage, the right needed to release an issue to the pipeline.
 *
 * @remarks
 * Only people who could label the issue themselves may start an agent on it; an issue's text
 * becomes the agent's instructions.
 */
export function canTriage(permission: RepositoryPermission): boolean {
  return PERMISSION_ORDER.indexOf(permission) >= PERMISSION_ORDER.indexOf('triage');
}

/** Whether `owner/name` is in the allowlist, ignoring case as GitHub does. */
export function isAllowedRepository(
  repository: string,
  allowlist: readonly string[],
): boolean {
  const wanted = repository.toLowerCase();

  return allowlist.some((allowed) => allowed.toLowerCase() === wanted);
}

/** The changed paths that match a denied pattern, in the order they were given. */
export function findDeniedPaths(
  changedPaths: readonly string[],
  deniedPatterns: readonly string[],
): string[] {
  return changedPaths.filter((path) => deniedPatterns.some((pattern) => posix.matchesGlob(
    path,
    pattern,
  )));
}

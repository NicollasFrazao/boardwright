/**
 * Reads, from package-lock.json, the packages of the Claude Agent SDK that the Action installs when it
 * runs: the SDK and its native binaries, each with the tarball and the hash the lockfile pinned. The
 * bundle leaves them out (the SDK is under Anthropic's commercial terms, and a binary is hundreds of
 * megabytes), so the lockfile stays the one place their versions are chosen.
 */

/** The package the bundle imports but does not contain. */
export const AGENT_SDK = '@anthropic-ai/claude-agent-sdk';

const LOCK_PATH = new RegExp(`^node_modules/(${AGENT_SDK}(?:-[a-z0-9-]+)?)$`, 'u');

/** The pinned packages, sorted by name, with the platform fields only where the lockfile has them. */
export function pinnedAgentPackages(lock) {
  const pinned = [];

  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const name = LOCK_PATH.exec(path)?.[1];

    if (name === undefined) {
      continue;
    }

    if (typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string') {
      throw new Error(`package-lock.json has no tarball or integrity for ${name}.`);
    }

    pinned.push({
      name,
      version: entry.version,
      url: entry.resolved,
      integrity: entry.integrity,
      ...entry.os === undefined ? {} : { os: entry.os },
      ...entry.cpu === undefined ? {} : { cpu: entry.cpu },
      ...entry.libc === undefined ? {} : { libc: entry.libc },
    });
  }

  if (!pinned.some((source) => source.name === AGENT_SDK)) {
    throw new Error(`package-lock.json does not pin ${AGENT_SDK}.`);
  }

  return pinned.sort((left, right) => left.name.localeCompare(right.name));
}

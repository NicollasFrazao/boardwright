import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  join,
} from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * A package of the Claude Agent SDK as `package-lock.json` pins it: the SDK itself, or one of its native
 * binaries, which name the machines they run on.
 */
export interface PinnedPackage {
  readonly name: string;
  readonly version: string;

  /** The tarball on the npm registry. */
  readonly url: string;

  /** The lockfile's Subresource Integrity hash of the tarball, `sha512-<base64>`. */
  readonly integrity: string;
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly libc?: readonly string[];
}

/** What a native binary has to match. `libc` is only known on Linux. */
export interface Machine {
  readonly platform: string;
  readonly arch: string;
  readonly libc: 'glibc' | 'musl' | undefined;
}

/** No native binary of the Agent SDK runs on this machine. */
export class UnsupportedMachineError extends Error {
  constructor(machine: Machine) {
    super(`The Claude Agent SDK has no native binary for ${[
      machine.platform,
      machine.arch,
      machine.libc,
    ].filter((part) => part !== undefined).join('-')}.`);

    this.name = 'UnsupportedMachineError';
  }
}

/** A downloaded tarball whose hash is not the one the lockfile pinned. */
export class IntegrityError extends Error {
  constructor(source: PinnedPackage) {
    super(`The tarball of ${source.name}@${source.version} does not match the integrity pinned in package-lock.json; nothing was installed.`);
    this.name = 'IntegrityError';
  }
}

/**
 * The packages this machine needs: every package without a platform constraint, and the one native
 * binary whose `os`, `cpu` and `libc` match, as npm would choose among optional dependencies.
 *
 * @throws {@link UnsupportedMachineError} when no native binary matches.
 */
export function selectPackages(
  pinned: readonly PinnedPackage[],
  machine: Machine,
): PinnedPackage[] {
  const common = pinned.filter((source) => source.os === undefined);

  const binary = pinned.find((source) => source.os !== undefined
    && matches(
      source.os,
      machine.platform,
    )
    && matches(
      source.cpu,
      machine.arch,
    )
    && matches(
      source.libc,
      machine.libc,
    ));

  if (binary === undefined) {
    throw new UnsupportedMachineError(machine);
  }

  return [
    ...common,
    binary,
  ];
}

/** An absent constraint, or an unknown value, matches anything. */
function matches(
  allowed: readonly string[] | undefined,
  value: string | undefined,
): boolean {
  return allowed === undefined
    || value === undefined
    || allowed.includes(value);
}

/** The Subresource Integrity hash of some bytes, in the lockfile's `sha512-<base64>` form. */
export function integrityOf(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** Where the packages are fetched from and unpacked to. */
export interface PackageStore {
  /** The version of the package already unpacked; `undefined` when there is none. */
  installedVersion(name: string): Promise<string | undefined>;
  download(url: string): Promise<Uint8Array>;

  /** Replaces the package with the contents of an npm tarball. */
  unpack(name: string, tarball: Uint8Array): Promise<void>;
}

/**
 * Installs the packages that are not already there at their pinned version, checking every tarball
 * against the lockfile's hash before unpacking it.
 *
 * @returns The packages it installed, as `name@version`.
 *
 * @throws {@link IntegrityError} when a tarball does not match its pinned hash.
 */
export async function installPackages(
  packages: readonly PinnedPackage[],
  store: PackageStore,
): Promise<string[]> {
  const installed: string[] = [];

  for (const source of packages) {
    if (await store.installedVersion(source.name) === source.version) {
      continue;
    }

    const tarball = await store.download(source.url);

    if (integrityOf(tarball) !== source.integrity) {
      throw new IntegrityError(source);
    }

    await store.unpack(
      source.name,
      tarball,
    );

    installed.push(`${source.name}@${source.version}`);
  }

  return installed;
}

/** How the store on disk reaches the registry. */
export interface DiskStoreOptions {
  /** The `node_modules` directory the packages go to. */
  readonly directory: string;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * A store that unpacks into a `node_modules` directory with the system `tar`.
 *
 * @remarks
 * A package is unpacked into a staging directory next to its destination and moved into place, so a run
 * stopped halfway leaves no half-written package that a later run would take as installed.
 */
export function diskPackageStore(options: DiskStoreOptions): PackageStore {
  const fetch = options.fetch ?? globalThis.fetch;

  return {
    installedVersion: async (name) => {
      try {
        const manifest = JSON.parse(await readFile(
          join(
            options.directory,
            name,
            'package.json',
          ),
          'utf8',
        )) as { version?: unknown };

        return typeof manifest.version === 'string' ? manifest.version : undefined;
      } catch {
        return undefined;
      }
    },
    download: async (url) => {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Downloading ${url} failed: HTTP ${String(response.status)}.`);
      }

      return new Uint8Array(await response.arrayBuffer());
    },
    unpack: (
      name,
      tarball,
    ) => unpackInto(
      join(
        options.directory,
        name,
      ),
      tarball,
    ),
  };
}

async function unpackInto(
  destination: string,
  tarball: Uint8Array,
): Promise<void> {
  await mkdir(
    dirname(destination),
    { recursive: true },
  );

  const staging = await mkdtemp(`${destination}.staging-`);

  try {
    const archive = join(
      staging,
      'package.tgz',
    );

    await writeFile(
      archive,
      tarball,
    );

    await run(
      'tar',
      [
        '-xzf',
        archive,
        '-C',
        staging,
      ],
    );

    await rm(
      destination,
      {
        recursive: true,
        force: true,
      },
    );

    // npm tarballs keep their files under `package/`.
    await rename(
      join(
        staging,
        'package',
      ),
      destination,
    );
  } finally {
    await rm(
      staging,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

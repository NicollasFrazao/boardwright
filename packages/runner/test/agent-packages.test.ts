import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  diskPackageStore,
  installPackages,
  integrityOf,
  IntegrityError,
  selectPackages,
  UnsupportedMachineError,
  type PackageStore,
  type PinnedPackage,
} from '../src/agent-packages.ts';

const run = promisify(execFile);

const SDK: PinnedPackage = {
  name: '@anthropic-ai/claude-agent-sdk',
  version: '1.0.0',
  url: 'https://registry.example/sdk.tgz',
  integrity: 'sha512-sdk',
};

function binary(
  suffix: string,
  constraints: Pick<PinnedPackage, 'os' | 'cpu' | 'libc'>,
): PinnedPackage {
  return {
    name: `${SDK.name}-${suffix}`,
    version: '1.0.0',
    url: `https://registry.example/${suffix}.tgz`,
    integrity: `sha512-${suffix}`,
    ...constraints,
  };
}

const PINNED = [
  SDK,
  binary(
    'darwin-arm64',
    {
      os: ['darwin'],
      cpu: ['arm64'],
    },
  ),
  binary(
    'linux-x64',
    {
      os: ['linux'],
      cpu: ['x64'],
      libc: ['glibc'],
    },
  ),
  binary(
    'linux-x64-musl',
    {
      os: ['linux'],
      cpu: ['x64'],
      libc: ['musl'],
    },
  ),
];

describe('selectPackages', () => {
  it('takes the SDK and the binary of the machine, telling glibc from musl', () => {
    expect(selectPackages(
      PINNED,
      {
        platform: 'linux',
        arch: 'x64',
        libc: 'glibc',
      },
    ).map((source) => source.name)).toEqual([
      SDK.name,
      `${SDK.name}-linux-x64`,
    ]);

    expect(selectPackages(
      PINNED,
      {
        platform: 'linux',
        arch: 'x64',
        libc: 'musl',
      },
    ).map((source) => source.name)).toEqual([
      SDK.name,
      `${SDK.name}-linux-x64-musl`,
    ]);

    expect(selectPackages(
      PINNED,
      {
        platform: 'darwin',
        arch: 'arm64',
        libc: undefined,
      },
    ).map((source) => source.name)).toEqual([
      SDK.name,
      `${SDK.name}-darwin-arm64`,
    ]);
  });

  it('refuses a machine no binary runs on', () => {
    expect(() => selectPackages(
      PINNED,
      {
        platform: 'win32',
        arch: 'arm64',
        libc: undefined,
      },
    )).toThrow(UnsupportedMachineError);

    expect(() => selectPackages(
      PINNED,
      {
        platform: 'linux',
        arch: 'arm64',
        libc: 'glibc',
      },
    )).toThrow('no native binary for linux-arm64-glibc');
  });
});

describe('integrityOf', () => {
  it('is the lockfile\'s sha512 form', () => {
    expect(integrityOf(new TextEncoder().encode('abc'))).toBe('sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==');
  });
});

/** A store in memory that records what it unpacked. */
function memoryStore(
  tarballs: Readonly<Record<string, string>>,
  installed: Record<string, string> = {},
): PackageStore & { readonly unpacked: string[] } {
  const unpacked: string[] = [];

  return {
    unpacked,
    installedVersion: (name) => Promise.resolve(installed[name]),
    download: (url) => Promise.resolve(new TextEncoder().encode(tarballs[url] ?? '')),
    unpack: (name) => {
      unpacked.push(name);

      return Promise.resolve();
    },
  };
}

function pinnedTo(
  text: string,
  source: PinnedPackage = SDK,
): PinnedPackage {
  return {
    ...source,
    integrity: integrityOf(new TextEncoder().encode(text)),
  };
}

describe('installPackages', () => {
  it('unpacks a tarball that matches its pinned hash', async () => {
    const store = memoryStore({ [SDK.url]: 'sdk bytes' });

    expect(await installPackages(
      [pinnedTo('sdk bytes')],
      store,
    )).toEqual([`${SDK.name}@1.0.0`]);

    expect(store.unpacked).toEqual([SDK.name]);
  });

  it('skips a package already there at the pinned version, and replaces another version', async () => {
    const linux = binary(
      'linux-x64',
      {
        os: ['linux'],
        cpu: ['x64'],
      },
    );

    const store = memoryStore(
      {
        [SDK.url]: 'sdk bytes',
        [linux.url]: 'linux bytes',
      },
      {
        [SDK.name]: '1.0.0',
        [linux.name]: '0.9.0',
      },
    );

    expect(await installPackages(
      [
        pinnedTo('sdk bytes'),
        pinnedTo(
          'linux bytes',
          linux,
        ),
      ],
      store,
    )).toEqual([`${linux.name}@1.0.0`]);
  });

  it('unpacks nothing from a tarball whose hash differs', async () => {
    const store = memoryStore({ [SDK.url]: 'tampered bytes' });

    await expect(installPackages(
      [pinnedTo('sdk bytes')],
      store,
    )).rejects.toThrow(IntegrityError);

    expect(store.unpacked).toEqual([]);
  });
});

describe('diskPackageStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(
      tmpdir(),
      'boardwright-packages-',
    ));
  });

  afterEach(async () => {
    await rm(
      root,
      {
        recursive: true,
        force: true,
      },
    );
  });

  /** An npm-style tarball: the files under `package/`. */
  async function tarball(version: string): Promise<Uint8Array> {
    const source = join(
      root,
      `source-${version}`,
    );

    await mkdir(
      join(
        source,
        'package',
      ),
      { recursive: true },
    );

    await writeFile(
      join(
        source,
        'package',
        'package.json',
      ),
      JSON.stringify({ version }),
    );

    await run(
      'tar',
      [
        '-czf',
        join(
          source,
          'out.tgz',
        ),
        '-C',
        source,
        'package',
      ],
    );

    return new Uint8Array(await readFile(join(
      source,
      'out.tgz',
    )));
  }

  it('unpacks a scoped package into node_modules, replacing an older one, and reads its version', async () => {
    const modules = join(
      root,
      'node_modules',
    );

    const store = diskPackageStore({ directory: modules });

    expect(await store.installedVersion(SDK.name)).toBeUndefined();

    await store.unpack(
      SDK.name,
      await tarball('0.9.0'),
    );

    await store.unpack(
      SDK.name,
      await tarball('1.0.0'),
    );

    expect(await store.installedVersion(SDK.name)).toBe('1.0.0');

    // No staging directory is left next to the package.
    expect(await readdir(join(
      modules,
      '@anthropic-ai',
    ))).toEqual(['claude-agent-sdk']);
  });

  it('downloads through fetch and reports a failed response', async () => {
    const store = diskPackageStore({
      directory: root,
      fetch: (url) => Promise.resolve(url === 'https://registry.example/ok.tgz'
        ? new Response('bytes')
        : new Response(
            'missing',
            { status: 404 },
          )),
    });

    expect(new TextDecoder().decode(await store.download('https://registry.example/ok.tgz'))).toBe('bytes');

    await expect(store.download('https://registry.example/gone.tgz')).rejects.toThrow('HTTP 404');
  });
});

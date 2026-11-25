import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  dirname,
  join,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionCommand,
  ActionInputError,
  type ActionCommand,
} from './action-inputs.ts';
import {
  diskPackageStore,
  installPackages,
  IntegrityError,
  selectPackages,
  UnsupportedMachineError,
  type Machine,
  type PinnedPackage,
} from './agent-packages.ts';

// The entry of the GitHub Action, run from its bundle in dist/: it installs the Agent SDK the bundle leaves
// out, then runs the bundled CLI once. The CLI is a child process so that it starts with an environment
// built for it, and so that the SDK it imports is already in dist/node_modules when it loads.

const EXIT_USAGE = 2;

const bundle = dirname(fileURLToPath(import.meta.url));

/** The machine the native binary has to match; glibc and musl are told apart on Linux only. */
function machine(): Machine {
  if (process.platform !== 'linux') {
    return {
      platform: process.platform,
      arch: process.arch,
      libc: undefined,
    };
  }

  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };

  return {
    platform: process.platform,
    arch: process.arch,
    libc: report.header?.glibcVersionRuntime === undefined ? 'musl' : 'glibc',
  };
}

/** Runs the bundled CLI, forwarding the cancellation of the job so the current tick can finish. */
function runCli(command: ActionCommand): Promise<number> {
  const child = spawn(
    process.execPath,
    [
      join(
        bundle,
        'cli.js',
      ),
      ...command.argv,
    ],
    {
      env: command.environment,
      stdio: 'inherit',
    },
  );

  for (const signal of [
    'SIGINT',
    'SIGTERM',
  ] as const) {
    process.on(
      signal,
      () => child.kill(signal),
    );
  }

  return new Promise((
    resolve,
    reject,
  ) => {
    child.once(
      'error',
      reject,
    );

    child.once(
      'exit',
      (code) => {
        resolve(code ?? 1);
      },
    );
  });
}

try {
  const command = actionCommand(process.env);

  const pinned = JSON.parse(await readFile(
    join(
      bundle,
      'agent-packages.json',
    ),
    'utf8',
  )) as PinnedPackage[];

  const installed = await installPackages(
    selectPackages(
      pinned,
      machine(),
    ),
    diskPackageStore({
      directory: join(
        bundle,
        'node_modules',
      ),
    }),
  );

  for (const name of installed) {
    process.stdout.write(`Installed ${name}\n`);
  }

  process.exitCode = await runCli(command);
} catch (error) {
  if (
    error instanceof ActionInputError
    || error instanceof IntegrityError
    || error instanceof UnsupportedMachineError
  ) {
    process.stdout.write(`::error::${error.message}\n`);
    process.exitCode = EXIT_USAGE;
  } else {
    throw error;
  }
}

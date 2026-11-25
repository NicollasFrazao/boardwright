import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { RepositoryContextProvider } from '@boardwright/context';
import {
  diagnose,
  tick,
  type AgentProvider,
  type BoardPort,
  type Logger,
  type MergerPort,
  type PipelineConfig,
  type RepoHostPort,
  type TickDependencies,
  type WorkspacePort,
} from '@boardwright/core';
import {
  ConfigFileError,
  DEFAULT_CONFIG_PATH,
  readConfigText,
  starterConfig,
} from './config-file.ts';
import {
  formatDoctor,
  formatTick,
} from './format.ts';
import { runDaemon } from './daemon.ts';
import { repositoryFiles } from './repository-files.ts';

/** Exit codes: success, checks or runs that failed, and a command that could not run. */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
} as const;

/** The outside world of the program: files, output and the adapters. */
export interface ProgramEnvironment {
  readonly variables: Readonly<Record<string, string | undefined>>;
  readFile(path: string): Promise<string | undefined>;

  /** Writes a new file; resolves `false` when the file already exists. */
  createFile(path: string, text: string): Promise<boolean>;
  stdout(text: string): void;
  stderr(text: string): void;

  /** The adapters that read and write the board and the repositories. */
  connect(config: PipelineConfig, token: string): GitHubAdapters;

  /** The adapters that act: the workspaces and the agent. Only `once` without `--dry-run` asks for them. */
  connectAgents(config: PipelineConfig, token: string): AgentAdapters;

  /** Aborted on SIGINT or SIGTERM. */
  shutdownSignal(): AbortSignal;

  /** Waits, ending early when the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;

  /** Takes a machine-wide lock; resolves its release, or `undefined` when another process holds it. */
  acquireLock(name: string): Promise<(() => Promise<void>) | undefined>;

  /** The merger, on its own token. Only `once` without `--dry-run` with a merge stage asks for it. */
  connectMerger(token: string): MergerPort;
}

interface GitHubAdapters {
  readonly board: BoardPort;
  readonly repoHost: RepoHostPort;
}

interface AgentAdapters {
  readonly workspaces: WorkspacePort;
  readonly agent: AgentProvider;
}

const TOKEN_VARIABLES = [
  'BOARDWRIGHT_GITHUB_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
];

const MS_PER_SECOND = 1000;
const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 10;

/** The longest wait between failing ticks: 15 minutes. */
const MAX_BACKOFF_MS = 900_000;

/** The help text. */
export const USAGE = `Usage: boardwright <command> [options]

Commands:
  doctor            Check the config against the board and the repositories. Changes nothing.
  once              Run one tick: claim the items that are due, run their stage, record the outcome.
  once --dry-run    Print what one tick would do. Changes nothing.
  run               Run ticks until SIGINT or SIGTERM: --interval <seconds> (default ${DEFAULT_INTERVAL_SECONDS}, at least ${MIN_INTERVAL_SECONDS}).
  init              Write a starter ${DEFAULT_CONFIG_PATH}: --owner <login> --project <number> --repository <owner/name>...

Options:
  --config <path>   The config file (default: ${DEFAULT_CONFIG_PATH})
  --json            Print the report as JSON
  --help            Show this help

The GitHub token is read from BOARDWRIGHT_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN. It needs read access to the
board (a classic token needs the project scope for a user's project) and, for once, write access to the
repositories' contents, issues and pull requests. The agent authenticates through the Claude Agent SDK's
documented methods, such as ANTHROPIC_API_KEY; boardwright never handles those credentials.`;

class UsageError extends Error {}

/**
 * The tick interval from `--interval`.
 *
 * @throws {@link UsageError} when it is not a whole number of seconds of at least the minimum.
 */
function intervalFrom(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_INTERVAL_SECONDS;
  }

  const seconds = Number(value);

  if (
    !Number.isInteger(seconds)
    || seconds < MIN_INTERVAL_SECONDS
  ) {
    throw new UsageError(`--interval needs a whole number of seconds, at least ${MIN_INTERVAL_SECONDS}.`);
  }

  return seconds;
}

/**
 * Runs one command and returns its exit code.
 *
 * @remarks
 * Errors the user can fix (usage, config, missing token) are printed as one message and exit with 2;
 * anything else propagates.
 */
export async function runProgram(
  argv: readonly string[],
  environment: ProgramEnvironment,
): Promise<number> {
  try {
    return await dispatch(
      argv,
      environment,
    );
  } catch (error) {
    if (
      error instanceof UsageError
      || error instanceof ConfigFileError
    ) {
      environment.stderr(error.message);

      return EXIT.usage;
    }

    throw error;
  }
}

async function dispatch(
  argv: readonly string[],
  environment: ProgramEnvironment,
): Promise<number> {
  const {
    values,
    positionals,
  } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      interval: { type: 'string' },
      owner: { type: 'string' },
      project: { type: 'string' },
      repository: {
        type: 'string',
        multiple: true,
      },
    },
    strict: false,
  });

  const [command] = positionals;

  const options = {
    configPath: typeof values.config === 'string' ? values.config : DEFAULT_CONFIG_PATH,
    json: values.json === true,
  };

  if (
    values.help === true
    || command === undefined
    || command === 'help'
  ) {
    environment.stdout(USAGE);

    return EXIT.ok;
  }

  switch (command) {
    case 'doctor':
      return doctor(
        environment,
        options,
      );
    case 'once':
      return once(
        environment,
        {
          ...options,
          isDryRun: values['dry-run'] === true,
        },
      );
    case 'run':
      return run(
        environment,
        {
          ...options,
          intervalSeconds: intervalFrom(values.interval),
        },
      );
    case 'init':
      return init(
        environment,
        options.configPath,
        values,
      );
    default:
      throw new UsageError(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

interface CommonOptions {
  readonly configPath: string;
  readonly json: boolean;
}

async function doctor(
  environment: ProgramEnvironment,
  options: CommonOptions,
): Promise<number> {
  const config = await loadConfig(
    environment,
    options.configPath,
  );

  const {
    board,
    repoHost,
  } = environment.connect(
    config,
    tokenFrom(environment),
  );

  const report = await diagnose({
    config,
    board,
    repoHost,
    context: new RepositoryContextProvider(repositoryFiles(repoHost)),
  });

  environment.stdout(options.json ? JSON.stringify(
    report,
    null,
    2,
  ) : formatDoctor(report));

  return report.hasFailures ? EXIT.failed : EXIT.ok;
}

async function once(
  environment: ProgramEnvironment,
  options: CommonOptions & { readonly isDryRun: boolean },
): Promise<number> {
  const config = await loadConfig(
    environment,
    options.configPath,
  );

  const report = await tick(
    tickDependencies(
      environment,
      config,
      options.isDryRun,
    ),
    { dryRun: options.isDryRun },
  );

  environment.stdout(options.json ? JSON.stringify(
    report,
    null,
    2,
  ) : formatTick(
    report,
    options.isDryRun,
  ));

  return report.entries.some((entry) => entry.result?.kind === 'error') ? EXIT.failed : EXIT.ok;
}

/**
 * Runs ticks until SIGINT or SIGTERM, holding a lock so a second runner for the same board on this machine
 * refuses to start.
 */
async function run(
  environment: ProgramEnvironment,
  options: CommonOptions & { readonly intervalSeconds: number },
): Promise<number> {
  const config = await loadConfig(
    environment,
    options.configPath,
  );

  const dependencies = tickDependencies(
    environment,
    config,
    false,
  );

  const release = await environment.acquireLock(`${config.project.owner}-${config.project.number}`);

  if (release === undefined) {
    throw new UsageError(`Another boardwright runner already works on ${config.project.owner}#${config.project.number} on this machine.`);
  }

  try {
    await runDaemon({
      intervalMs: options.intervalSeconds * MS_PER_SECOND,
      maxBackoffMs: MAX_BACKOFF_MS,
      signal: environment.shutdownSignal(),
      tick: () => tick(dependencies),
      sleep: (
        ms,
        signal,
      ) => environment.sleep(
        ms,
        signal,
      ),
      logger: dependencies.logger,
    });
  } finally {
    await release();
  }

  return EXIT.ok;
}

function tickDependencies(
  environment: ProgramEnvironment,
  config: PipelineConfig,
  isDryRun: boolean,
): TickDependencies {
  const token = tokenFrom(environment);

  return {
    config,
    ...environment.connect(
      config,
      token,
    ),
    ...isDryRun ? dryRunAdapters() : environment.connectAgents(
      config,
      token,
    ),
    merger: isDryRun ? dryRunMerger() : mergerFor(
      environment,
      config,
    ),
    context: new RepositoryContextProvider(),
    clock: { now: () => new Date() },
    runIds: { next: () => randomUUID() },
    logger: isDryRun ? silentLogger() : jsonLogger(environment),
  };
}

async function init(
  environment: ProgramEnvironment,
  configPath: string,
  values: {
    owner?: unknown;
    project?: unknown;
    repository?: unknown;
  },
): Promise<number> {
  const projectNumber = Number(values.project);
  const repositories = Array.isArray(values.repository) ? values.repository.filter((entry) => typeof entry === 'string') : [];

  if (
    typeof values.owner !== 'string'
    || !Number.isInteger(projectNumber)
    || projectNumber <= 0
    || repositories.length === 0
  ) {
    throw new UsageError('init needs --owner <login>, --project <number> and at least one --repository <owner/name>.');
  }

  const text = starterConfig({
    owner: values.owner,
    projectNumber,
    repositories,
  });

  readConfigText(
    configPath,
    text,
  );

  if (!await environment.createFile(
    configPath,
    text,
  )) {
    throw new UsageError(`${configPath} already exists; init never overwrites a config.`);
  }

  environment.stdout(`Wrote ${configPath}. Run boardwright doctor to check it against the board.`);

  return EXIT.ok;
}

async function loadConfig(
  environment: ProgramEnvironment,
  path: string,
): Promise<PipelineConfig> {
  const text = await environment.readFile(path);

  if (text === undefined) {
    throw new UsageError(`${path} not found. Create one with boardwright init, or pass --config <path>.`);
  }

  return readConfigText(
    path,
    text,
  );
}

function tokenFrom(environment: ProgramEnvironment): string {
  for (const name of TOKEN_VARIABLES) {
    const token = environment.variables[name];

    if (
      token !== undefined
      && token !== ''
    ) {
      return token;
    }
  }

  throw new UsageError(`No GitHub token: set one of ${TOKEN_VARIABLES.join(', ')}.`);
}

/**
 * The acting adapters of a dry run: a dry run only plans, so they are never called.
 *
 * @throws {@link Error} from those adapters if a change ever made a dry run reach them.
 */
function dryRunAdapters(): AgentAdapters {
  const unavailable = (): Promise<never> => Promise.reject(new Error('A dry run never acts.'));

  return {
    workspaces: {
      prepare: unavailable,
      changedPaths: unavailable,
      hasCommits: unavailable,
      push: unavailable,
      dispose: unavailable,
    },
    agent: { run: unavailable },
  };
}

/** A dry run's merger: a dry run never merges. */
function dryRunMerger(): MergerPort {
  return { merge: () => Promise.reject(new Error('A dry run never acts.')) };
}

/**
 * The merger for a config with a merge stage, on `BOARDWRIGHT_MERGE_TOKEN`.
 *
 * @throws {@link UsageError} when the config has a merge stage and the token is missing: the identity that
 * merges must not be the one that opened the pull request.
 */
function mergerFor(
  environment: ProgramEnvironment,
  config: PipelineConfig,
): MergerPort {
  const token = environment.variables.BOARDWRIGHT_MERGE_TOKEN;

  if (
    token === undefined
    || token === ''
  ) {
    if (config.stages.some((stage) => stage.id === 'merge')) {
      throw new UsageError('The merge stage needs BOARDWRIGHT_MERGE_TOKEN, a token other than the one that opens pull requests.');
    }

    return { merge: () => Promise.reject(new Error('No merge stage is configured.')) };
  }

  return environment.connectMerger(token);
}

function silentLogger(): Logger {
  return {
    info: () => undefined,
    warn: () => undefined,
  };
}

/** One JSON object per line on stderr, so the report on stdout stays readable. */
function jsonLogger(environment: ProgramEnvironment): Logger {
  const write = (
    level: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void => {
    environment.stderr(JSON.stringify({
      level,
      event,
      ...fields,
    }));
  };

  return {
    info: (
      event,
      fields,
    ) => {
      write(
        'info',
        event,
        fields,
      );
    },
    warn: (
      event,
      fields,
    ) => {
      write(
        'warn',
        event,
        fields,
      );
    },
  };
}

import { z } from 'zod';

const DEFAULT_MAX_TURNS = 80;
const DEFAULT_TIMEOUT_MINUTES = 60;
const DEFAULT_MAX_ATTEMPTS = 3;
const MS_PER_MINUTE = 60_000;

/** A grace period after a run's timeout before a silent run is presumed dead. */
const STALE_GRACE_MINUTES = 5;

/** Paths an agent may never change: CI definitions and the usual secret files. */
export const DEFAULT_DENIED_PATHS: readonly string[] = [
  '.github/workflows/**',
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
];

const repositoryName = z.string().regex(
  /^[\w.-]+\/[\w.-]+$/u,
  'expected owner/name',
);

const statusName = z.string().trim().min(1);

const phase = z.enum([
  'P',
  'R',
  'E',
  'V',
  'C',
]);

const limitsOverride = {
  maxTurns: z.int().positive().optional(),
  timeoutMinutes: z.int().positive().optional(),
  maxAttempts: z.int().positive().optional(),
};

const implementStage = z.object({
  id: z.literal('implement'),
  when: z.object({ status: statusName }).prefault({ status: 'Ready' }),
  claim: z.object({ status: statusName }).prefault({ status: 'In Progress' }),
  done: z.object({ status: statusName }).prefault({ status: 'In review' }),
  blocked: z.object({ status: statusName }).prefault({ status: 'Todo' }),
  context: z.object({
    phase: phase.default('E'),
    agent: z.string().min(1).default('feature-developer'),
    agentByLabel: z.record(
      z.string(),
      z.string().min(1),
    ).default({ bug: 'bug-fixer' }),
  }).prefault({}),
  ...limitsOverride,
}).strict();

const reviewStage = z.object({
  id: z.literal('review'),
  when: z.object({ status: statusName }).prefault({ status: 'In review' }),
  context: z.object({
    phase: phase.default('R'),
    agent: z.string().min(1).default('code-reviewer'),
    agentByLabel: z.record(
      z.string(),
      z.string().min(1),
    ).default({}),
  }).prefault({}),
  ...limitsOverride,
}).strict();

const stage = z.discriminatedUnion(
  'id',
  [
    implementStage,
    reviewStage,
  ],
);

/** The schema of `pipeline.config.yml`, with every default the docs promise. */
export const pipelineConfigSchema = z.object({
  project: z.object({
    owner: z.string().min(1),
    number: z.int().positive(),
    statusField: z.string().min(1).default('Status'),
  }).strict(),
  repositories: z.array(repositoryName).min(1),
  trigger: z.object({
    label: z.string().min(1).default('agent'),
    requireTriage: z.boolean().default(true),
  }).strict().prefault({}),
  concurrency: z.int().positive().default(1),
  provider: z.object({
    name: z.string().min(1).default('claude'),
    model: z.string().min(1).optional(),
  }).strict().prefault({}),
  git: z.object({
    /** Who the agent's commits are attributed to; without it, git's own config on the machine decides. */
    author: z.object({
      name: z.string().min(1),
      email: z.string().min(1),
    }).strict().optional(),
  }).strict().prefault({}),
  guardRails: z.object({
    deniedPaths: z.array(z.string().min(1)).default([...DEFAULT_DENIED_PATHS]),
    maxTurns: z.int().positive().default(DEFAULT_MAX_TURNS),
    timeoutMinutes: z.int().positive().default(DEFAULT_TIMEOUT_MINUTES),
    maxAttempts: z.int().positive().default(DEFAULT_MAX_ATTEMPTS),
  }).strict().prefault({}),
  stages: z.array(stage).min(1).refine(
    (stages) => new Set(stages.map((entry) => entry.id)).size === stages.length,
    'each stage may appear once',
  ),
}).strict();

/** A validated pipeline configuration. */
export type PipelineConfig = z.output<typeof pipelineConfigSchema>;

/** One stage of a validated configuration. */
export type StageConfig = PipelineConfig['stages'][number];

/** The limits that apply to one stage: its own overrides over the global guard rails. */
export interface StageLimits {
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly staleAfterMs: number;
}

/** A configuration that does not match the schema, with one readable line per problem. */
export class InvalidConfigError extends Error {
  /** One line per problem, each starting with the path of the offending field. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    const lines = problems.map((problem) => `- ${problem}`);

    super([
      'Invalid pipeline config:',
      ...lines,
    ].join('\n'));

    this.name = 'InvalidConfigError';
    this.problems = problems;
  }
}

/**
 * Validates a parsed config file and fills in the defaults.
 *
 * @throws {@link InvalidConfigError} when the input does not match the schema.
 */
export function parsePipelineConfig(input: unknown): PipelineConfig {
  const result = pipelineConfigSchema.safeParse(input);

  if (!result.success) {
    throw new InvalidConfigError(result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';

      return `${path}: ${issue.message}`;
    }));
  }

  return result.data;
}

/** The limits of a stage, falling back to the global guard rails. */
export function stageLimits(
  config: PipelineConfig,
  stageConfig: StageConfig,
): StageLimits {
  const timeoutMinutes = stageConfig.timeoutMinutes ?? config.guardRails.timeoutMinutes;

  return {
    maxTurns: stageConfig.maxTurns ?? config.guardRails.maxTurns,
    timeoutMs: timeoutMinutes * MS_PER_MINUTE,
    maxAttempts: stageConfig.maxAttempts ?? config.guardRails.maxAttempts,
    staleAfterMs: (timeoutMinutes + STALE_GRACE_MINUTES) * MS_PER_MINUTE,
  };
}

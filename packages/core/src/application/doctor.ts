import type {
  PipelineConfig,
  StageConfig,
} from './config.ts';
import type {
  BoardPort,
  ContextProvider,
  RepoHostPort,
} from './ports.ts';

/** How one check came out. */
export type CheckStatus = 'ok' | 'warn' | 'fail';

/** One line of a `doctor` report. */
export interface DoctorCheck {
  readonly subject: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

/** Everything `doctor` checked, in order. */
export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly hasFailures: boolean;
}

/** What `doctor` reads. Nothing here is written to. */
export interface DoctorDependencies {
  readonly config: PipelineConfig;
  readonly board: BoardPort;
  readonly repoHost: RepoHostPort;

  /** A context provider whose `root` is a repository name (`owner/name`), read remotely. */
  readonly context: ContextProvider;
}

/**
 * Checks a config against the board and the repositories without changing anything.
 *
 * @remarks
 * A missing Status option is a failure: the pipeline never creates one, so a stage that needs it
 * cannot move a card. A missing label or playbook is a warning: the pipeline still runs, with less.
 */
export async function diagnose(dependencies: DoctorDependencies): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  checks.push(...await checkBoard(dependencies));

  for (const repository of dependencies.config.repositories) {
    checks.push(...await checkRepository(
      dependencies,
      repository,
    ));
  }

  return {
    checks,
    hasFailures: checks.some((check) => check.status === 'fail'),
  };
}

async function checkBoard(dependencies: DoctorDependencies): Promise<DoctorCheck[]> {
  const { config } = dependencies;
  const subject = `board ${config.project.owner}#${config.project.number}`;

  try {
    const board = await dependencies.board.describe();

    if (board.statusOptions === undefined) {
      return [check(
        subject,
        'fail',
        `"${board.title}" has no single-select field named "${config.project.statusField}".`,
      )];
    }

    const options = new Set(board.statusOptions);
    const missing = requiredStatuses(config.stages).filter((status) => !options.has(status));

    return [
      check(
        subject,
        'ok',
        `"${board.title}", ${config.project.statusField}: ${board.statusOptions.join(', ')}.`,
      ),
      ...missing.map((status) => check(
        subject,
        'fail',
        `The Status "${status}" is not an option of the board; add it, or change the stage.`,
      )),
    ];
  } catch (error) {
    return [check(
      subject,
      'fail',
      messageOf(error),
    )];
  }
}

async function checkRepository(
  dependencies: DoctorDependencies,
  repository: string,
): Promise<DoctorCheck[]> {
  try {
    const defaultBranch = await dependencies.repoHost.getDefaultBranch(repository);
    const label = dependencies.config.trigger.label;

    const hasLabel = await dependencies.repoHost.hasLabel(
      repository,
      label,
    );

    const checks = [
      check(
        repository,
        'ok',
        `Reachable; default branch ${defaultBranch}.`,
      ),
      hasLabel
        ? check(
            repository,
            'ok',
            `The trigger label "${label}" exists.`,
          )
        : check(
            repository,
            'warn',
            `The trigger label "${label}" does not exist; create it to release issues to the pipeline.`,
          ),
    ];

    for (const stage of dependencies.config.stages) {
      checks.push(...await checkContext(
        dependencies,
        repository,
        stage,
      ));
    }

    return checks;
  } catch (error) {
    return [check(
      repository,
      'fail',
      messageOf(error),
    )];
  }
}

async function checkContext(
  dependencies: DoctorDependencies,
  repository: string,
  stage: StageConfig,
): Promise<DoctorCheck[]> {
  const subject = `${repository} ${stage.id}`;

  const agents = new Set([
    stage.context.agent,
    ...Object.values(stage.context.agentByLabel),
  ]);

  const checks: DoctorCheck[] = [];

  for (const agent of agents) {
    const context = await dependencies.context.load(
      repository,
      {
        phase: stage.context.phase,
        agent,
      },
    );

    checks.push(...context.warnings.map((warning) => check(
      subject,
      'warn',
      warning,
    )));

    if (context.playbook !== undefined) {
      checks.push(check(
        subject,
        'ok',
        `${context.source}: playbook ${context.playbook.path}, ${context.skills.length} skills for phase ${stage.context.phase}.`,
      ));
    } else if (context.instructionFiles.length > 0) {
      checks.push(check(
        subject,
        'ok',
        `${context.source}: the agent reads ${context.instructionFiles.join(', ')}.`,
      ));
    }
  }

  return checks;
}

function requiredStatuses(stages: readonly StageConfig[]): string[] {
  const statuses = stages.flatMap((stage) => statusesOf(stage));

  return [...new Set(statuses)];
}

/** The Status options a stage reads or moves cards to. */
function statusesOf(stage: StageConfig): string[] {
  switch (stage.id) {
    case 'implement':
      return [
        stage.when.status,
        stage.claim.status,
        stage.done.status,
        stage.blocked.status,
      ];
    case 'refine':
      return [
        stage.when.status,
        stage.done.status,
        stage.blocked.status,
      ];
    case 'review':
    case 'address-feedback':
      return [stage.when.status];
  }
}

function check(
  subject: string,
  status: CheckStatus,
  detail: string,
): DoctorCheck {
  return {
    subject,
    status,
    detail,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

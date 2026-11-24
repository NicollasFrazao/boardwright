import {
  canTriage,
  isAllowedRepository,
} from '../domain/guard-rails.ts';
import {
  formatIssueRef,
  type IssueRef,
  type RunOutcomeEvent,
} from '../domain/pipeline.ts';
import {
  decideRun,
  isClaimWinner,
  type RunDecision,
} from '../domain/run-decision.ts';
import {
  formatMarker,
  readMarkers,
  type RunMarker,
} from '../domain/run-marker.ts';
import {
  stageLimits,
  type PipelineConfig,
  type StageConfig,
} from './config.ts';
import {
  implementBranch,
  runImplementStage,
  type ImplementStageDependencies,
  type StageOutcome,
} from './implement-stage.ts';
import type {
  BoardItem,
  BoardPort,
  Clock,
  Issue,
  Logger,
  RunIdSource,
} from './ports.ts';

/** Everything one tick touches. */
export interface TickDependencies extends ImplementStageDependencies {
  readonly config: PipelineConfig;
  readonly board: BoardPort;
  readonly clock: Clock;
  readonly runIds: RunIdSource;
  readonly logger: Logger;
}

/** Why an item was left alone. */
export type SkipReason =
  | 'repository-not-allowed'
  | 'issue-closed'
  | 'not-triggered'
  | 'trigger-without-triage'
  | 'in-flight'
  | 'gave-up'
  | 'plan-failed';

/** What a tick decided for one item in one stage. */
export type PlannedAction =
  | {
    readonly kind: 'skip';
    readonly reason: SkipReason;
  }
  | {
    readonly kind: 'deferred';
    readonly attempt: number;
  }
  | {
    readonly kind: 'repair-status';
    readonly status: string;
  }
  | {
    readonly kind: 'give-up';
    readonly attempts: number;
  }
  | {
    readonly kind: 'run';
    readonly attempt: number;
  };

/** What carrying out an action produced. */
export type ExecutionResult =
  | { readonly kind: 'applied' }
  | { readonly kind: 'lost-claim' }
  | {
    readonly kind: 'completed';
    readonly outcome: StageOutcome;
  }
  | {
    readonly kind: 'error';
    readonly message: string;
  };

/** One line of a tick's report. */
export interface TickEntry {
  readonly stage: string;
  readonly itemId: string;
  readonly issue: IssueRef;
  readonly action: PlannedAction;

  /** `undefined` in a dry run and for actions that do nothing. */
  readonly result: ExecutionResult | undefined;
}

/** Everything a tick decided and did, in order. */
export interface TickReport {
  readonly entries: readonly TickEntry[];
}

/** How to run a tick. */
export interface TickOptions {
  /** Decide without writing anything: no comment, no Status change, no agent. */
  readonly dryRun: boolean;
}

interface Plan {
  readonly action: PlannedAction;
  readonly issue: Issue | undefined;
}

/**
 * One pass of the reconciliation loop: for each stage, the items in its `when` Status are planned and,
 * unless it is a dry run, acted on.
 *
 * @remarks
 * Every action is safe to repeat. At most `concurrency` runs start per tick; the rest are reported as
 * deferred and picked up by a later tick. A failure on one item is reported and does not stop the others.
 */
export async function tick(
  dependencies: TickDependencies,
  options: TickOptions = { dryRun: false },
): Promise<TickReport> {
  const items = await dependencies.board.listItems();
  const entries: TickEntry[] = [];
  const slots = { remaining: dependencies.config.concurrency };

  for (const stage of dependencies.config.stages) {
    const inStage = items.filter((item) => item.status === stage.when.status);

    for (const item of inStage) {
      entries.push(await handleItem(
        dependencies,
        stage,
        item,
        {
          dryRun: options.dryRun,
          slots,
        },
      ));
    }
  }

  return { entries };
}

async function handleItem(
  dependencies: TickDependencies,
  stage: StageConfig,
  item: BoardItem,
  state: {
    readonly dryRun: boolean;
    readonly slots: { remaining: number };
  },
): Promise<TickEntry> {
  const planned = await planSafely(
    dependencies,
    stage,
    item,
  );

  const action = takeSlot(
    planned.plan.action,
    state.slots,
  );

  const result = planned.error ?? (state.dryRun ? undefined : await executeSafely(
    dependencies,
    stage,
    item,
    {
      action,
      issue: planned.plan.issue,
    },
  ));

  const entry: TickEntry = {
    stage: stage.id,
    itemId: item.itemId,
    issue: item.issue,
    action,
    result,
  };

  dependencies.logger.info(
    'tick.item',
    {
      stage: entry.stage,
      issue: formatIssueRef(entry.issue),
      action: entry.action,
      result: entry.result,
      dryRun: state.dryRun,
    },
  );

  return entry;
}

function takeSlot(
  action: PlannedAction,
  slots: { remaining: number },
): PlannedAction {
  if (action.kind !== 'run') {
    return action;
  }

  if (slots.remaining === 0) {
    return {
      kind: 'deferred',
      attempt: action.attempt,
    };
  }

  slots.remaining -= 1;

  return action;
}

async function planSafely(
  dependencies: TickDependencies,
  stage: StageConfig,
  item: BoardItem,
): Promise<{
  readonly plan: Plan;
  readonly error: ExecutionResult | undefined;
}> {
  try {
    return {
      plan: await planItem(
        dependencies,
        stage,
        item,
      ),
      error: undefined,
    };
  } catch (error) {
    return {
      plan: skip(
        'plan-failed',
        undefined,
      ),
      error: reportError(
        dependencies,
        stage,
        item,
        error,
      ),
    };
  }
}

async function planItem(
  dependencies: TickDependencies,
  stage: StageConfig,
  item: BoardItem,
): Promise<Plan> {
  const {
    config,
    repoHost,
  } = dependencies;

  if (!isAllowedRepository(
    item.issue.repository,
    config.repositories,
  )) {
    return skip(
      'repository-not-allowed',
      undefined,
    );
  }

  const issue = await repoHost.getIssue(item.issue);

  const triggerProblem = await checkTrigger(
    dependencies,
    issue,
  );

  if (triggerProblem !== undefined) {
    return skip(
      triggerProblem,
      issue,
    );
  }

  const markers = readMarkers(
    await repoHost.listComments(item.issue),
    stage.id,
  );

  const openPullRequest = await repoHost.findOpenPullRequest(
    item.issue.repository,
    implementBranch(item.issue.number),
  );

  const decision = decideRun(
    markers,
    {
      now: dependencies.clock.now(),
      isResultInPlace: openPullRequest !== undefined,
    },
    stageLimits(
      config,
      stage,
    ),
  );

  return {
    action: actionFor(
      decision,
      stage,
    ),
    issue,
  };
}

async function checkTrigger(
  dependencies: TickDependencies,
  issue: Issue,
): Promise<SkipReason | undefined> {
  const trigger = dependencies.config.trigger;

  if (!issue.isOpen) {
    return 'issue-closed';
  }

  if (!issue.labels.includes(trigger.label)) {
    return 'not-triggered';
  }

  if (!trigger.requireTriage) {
    return undefined;
  }

  const actor = await dependencies.repoHost.findLabelActor(
    issue.ref,
    trigger.label,
  );

  return actor !== undefined && canTriage(actor.permission) ? undefined : 'trigger-without-triage';
}

function actionFor(
  decision: RunDecision,
  stage: StageConfig,
): PlannedAction {
  switch (decision.kind) {
    case 'start':
      return {
        kind: 'run',
        attempt: decision.attempt,
      };
    case 'in-flight':
      return {
        kind: 'skip',
        reason: 'in-flight',
      };
    case 'repair':
      return {
        kind: 'repair-status',
        status: stage.done.status,
      };
    case 'give-up':
      return {
        kind: 'give-up',
        attempts: decision.attempts,
      };
    case 'given-up':
      return {
        kind: 'skip',
        reason: 'gave-up',
      };
  }
}

function skip(
  reason: SkipReason,
  issue: Issue | undefined,
): Plan {
  return {
    action: {
      kind: 'skip',
      reason,
    },
    issue,
  };
}

async function executeSafely(
  dependencies: TickDependencies,
  stage: StageConfig,
  item: BoardItem,
  plan: Plan,
): Promise<ExecutionResult | undefined> {
  try {
    return await execute(
      dependencies,
      stage,
      item,
      plan,
    );
  } catch (error) {
    return reportError(
      dependencies,
      stage,
      item,
      error,
    );
  }
}

function reportError(
  dependencies: TickDependencies,
  stage: StageConfig,
  item: BoardItem,
  error: unknown,
): ExecutionResult {
  const message = error instanceof Error ? error.message : String(error);

  dependencies.logger.warn(
    'tick.item-error',
    {
      stage: stage.id,
      issue: formatIssueRef(item.issue),
      message,
    },
  );

  return {
    kind: 'error',
    message,
  };
}

async function execute(
  dependencies: TickDependencies,
  stage: StageConfig,
  item: BoardItem,
  plan: Plan,
): Promise<ExecutionResult | undefined> {
  const action = plan.action;

  switch (action.kind) {
    case 'skip':
    case 'deferred':
      return undefined;
    case 'repair-status':
      await dependencies.board.setStatus(
        item.itemId,
        action.status,
      );

      return { kind: 'applied' };
    case 'give-up':
      await giveUp(
        dependencies,
        stage,
        item,
        action.attempts,
      );

      return { kind: 'applied' };
    case 'run':
      return runStage(
        dependencies,
        stage,
        item,
        {
          attempt: action.attempt,
          issue: plan.issue,
        },
      );
  }
}

async function giveUp(
  dependencies: TickDependencies,
  stage: StageConfig,
  item: BoardItem,
  attempts: number,
): Promise<void> {
  await dependencies.repoHost.addComment(
    item.issue,
    markerComment(
      {
        stage: stage.id,
        runId: dependencies.runIds.next(),
        attempt: attempts,
        event: 'gave-up',
      },
      `Gave up on the ${stage.id} stage after ${attempts} attempts; a person needs to look at this issue. To let the pipeline try again, delete this comment.`,
    ),
  );

  await dependencies.board.setStatus(
    item.itemId,
    stage.blocked.status,
  );
}

async function runStage(
  dependencies: TickDependencies,
  stage: StageConfig,
  item: BoardItem,
  run: {
    readonly attempt: number;
    readonly issue: Issue | undefined;
  },
): Promise<ExecutionResult> {
  const issue = run.issue ?? await dependencies.repoHost.getIssue(item.issue);

  const marker: RunMarker = {
    stage: stage.id,
    runId: dependencies.runIds.next(),
    attempt: run.attempt,
    event: 'started',
  };

  await dependencies.repoHost.addComment(
    item.issue,
    markerComment(
      marker,
      `Started attempt ${run.attempt} of the ${stage.id} stage.`,
    ),
  );

  const markers = readMarkers(
    await dependencies.repoHost.listComments(item.issue),
    stage.id,
  );

  if (!isClaimWinner(
    markers,
    marker.runId,
    run.attempt,
  )) {
    return { kind: 'lost-claim' };
  }

  await dependencies.board.setStatus(
    item.itemId,
    stage.claim.status,
  );

  const outcome = await runImplementSafely(
    dependencies,
    stage,
    issue,
  );

  await dependencies.repoHost.addComment(
    item.issue,
    markerComment(
      {
        ...marker,
        event: outcome.event,
      },
      `Attempt ${run.attempt} of the ${stage.id} stage ended: ${outcome.event}.\n\n${outcome.detail}`,
    ),
  );

  await dependencies.board.setStatus(
    item.itemId,
    statusAfter(
      stage,
      outcome.event,
    ),
  );

  return {
    kind: 'completed',
    outcome,
  };
}

async function runImplementSafely(
  dependencies: TickDependencies,
  stage: StageConfig,
  issue: Issue,
): Promise<StageOutcome> {
  const limits = stageLimits(
    dependencies.config,
    stage,
  );

  try {
    return await runImplementStage(
      dependencies,
      {
        issue,
        stage,
        deniedPaths: dependencies.config.guardRails.deniedPaths,
        maxTurns: limits.maxTurns,
        timeoutMs: limits.timeoutMs,
        model: dependencies.config.provider.model,
      },
    );
  } catch (error) {
    return {
      event: 'failed',
      detail: `The run stopped with an error: ${error instanceof Error ? error.message : String(error)}`,
      pullRequest: undefined,
    };
  }
}

/** Where an item goes after a run: forward on success, back to its stage on failure, to a person otherwise. */
export function statusAfter(
  stage: StageConfig,
  event: RunOutcomeEvent,
): string {
  switch (event) {
    case 'succeeded':
      return stage.done.status;
    case 'failed':
      return stage.when.status;
    case 'blocked':
    case 'denied':
      return stage.blocked.status;
  }
}

function markerComment(
  marker: RunMarker,
  text: string,
): string {
  return `${formatMarker(marker)}\n**boardwright** · ${text}`;
}

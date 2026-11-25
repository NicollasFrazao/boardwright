import {
  canTriage,
  isAllowedRepository,
} from '../domain/guard-rails.ts';
import {
  formatIssueRef,
  type IssueRef,
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
import type {
  ImplementStageDependencies,
  StageOutcome,
} from './implement-stage.ts';
import type {
  BoardItem,
  BoardPort,
  Clock,
  Issue,
  Logger,
  MergerPort,
  RunIdSource,
} from './ports.ts';
import {
  handlerFor,
  type StageHandler,
} from './stages.ts';

/** Everything one tick touches. */
export interface TickDependencies extends ImplementStageDependencies {
  readonly config: PipelineConfig;
  readonly merger: MergerPort;
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
  | 'no-pull-request'
  | 'no-feedback'
  | 'merge-waiting'
  | 'merge-not-opted-in'
  | 'in-flight'
  | 'up-to-date'
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

interface StageInTick {
  readonly config: StageConfig;
  readonly handler: StageHandler;
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

  for (const config of dependencies.config.stages) {
    const stage = {
      config,
      handler: handlerFor(
        dependencies,
        config,
      ),
    };

    for (const item of items.filter((candidate) => candidate.status === config.when.status)) {
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
  stage: StageInTick,
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
    stage: stage.config.id,
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
  stage: StageInTick,
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
        stage.config,
        item,
        error,
      ),
    };
  }
}

async function planItem(
  dependencies: TickDependencies,
  stage: StageInTick,
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

  const problem = await checkTrigger(
    dependencies,
    issue,
  ) ?? await stage.handler.precondition(issue);

  if (problem !== undefined) {
    return skip(
      problem,
      issue,
    );
  }

  const markers = readMarkers(
    await repoHost.listComments(item.issue),
    stage.config.id,
  );

  const decision = decideRun(
    markers,
    {
      now: dependencies.clock.now(),
      isResultInPlace: await stage.handler.isResultInPlace(issue),
    },
    stageLimits(
      config,
      stage.config,
    ),
  );

  return {
    action: actionFor(
      decision,
      stage.handler,
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
  handler: StageHandler,
): PlannedAction {
  switch (decision.kind) {
    case 'start':
      return {
        kind: 'run',
        attempt: decision.attempt,
      };
    case 'in-flight':
      return skip(
        'in-flight',
        undefined,
      ).action;
    case 'repair':
      return handler.repairStatus === undefined
        ? skip(
          'up-to-date',
          undefined,
        ).action
        : {
            kind: 'repair-status',
            status: handler.repairStatus,
          };
    case 'give-up':
      return {
        kind: 'give-up',
        attempts: decision.attempts,
      };
    case 'given-up':
      return skip(
        'gave-up',
        undefined,
      ).action;
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
  stage: StageInTick,
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
      stage.config,
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
  stage: StageInTick,
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
  stage: StageInTick,
  item: BoardItem,
  attempts: number,
): Promise<void> {
  const stageId = stage.config.id;

  await dependencies.repoHost.addComment(
    item.issue,
    markerComment(
      {
        stage: stageId,
        runId: dependencies.runIds.next(),
        attempt: attempts,
        event: 'gave-up',
      },
      `Gave up on the ${stageId} stage after ${attempts} attempts; a person needs to look at this issue. To let the pipeline try again, delete this comment.`,
    ),
  );

  await moveTo(
    dependencies,
    item,
    stage.handler.giveUpStatus,
  );
}

async function runStage(
  dependencies: TickDependencies,
  stage: StageInTick,
  item: BoardItem,
  run: {
    readonly attempt: number;
    readonly issue: Issue | undefined;
  },
): Promise<ExecutionResult> {
  const stageId = stage.config.id;
  const issue = run.issue ?? await dependencies.repoHost.getIssue(item.issue);

  const marker: RunMarker = {
    stage: stageId,
    runId: dependencies.runIds.next(),
    attempt: run.attempt,
    event: 'started',
  };

  await dependencies.repoHost.addComment(
    item.issue,
    markerComment(
      marker,
      `Started attempt ${run.attempt} of the ${stageId} stage.`,
    ),
  );

  const markers = readMarkers(
    await dependencies.repoHost.listComments(item.issue),
    stageId,
  );

  if (!isClaimWinner(
    markers,
    marker.runId,
    run.attempt,
  )) {
    return { kind: 'lost-claim' };
  }

  await moveTo(
    dependencies,
    item,
    stage.handler.claimStatus,
  );

  const outcome = await runSafely(
    stage.handler,
    issue,
  );

  await dependencies.repoHost.addComment(
    item.issue,
    markerComment(
      {
        ...marker,
        event: outcome.event,
      },
      `Attempt ${run.attempt} of the ${stageId} stage ended: ${outcome.event}.\n\n${outcome.detail}`,
    ),
  );

  await moveTo(
    dependencies,
    item,
    stage.handler.statusAfter(outcome.event),
  );

  return {
    kind: 'completed',
    outcome,
  };
}

async function runSafely(
  handler: StageHandler,
  issue: Issue,
): Promise<StageOutcome> {
  try {
    return await handler.run(issue);
  } catch (error) {
    return {
      event: 'failed',
      detail: `The run stopped with an error: ${error instanceof Error ? error.message : String(error)}`,
      pullRequest: undefined,
    };
  }
}

async function moveTo(
  dependencies: TickDependencies,
  item: BoardItem,
  status: string | undefined,
): Promise<void> {
  if (status !== undefined) {
    await dependencies.board.setStatus(
      item.itemId,
      status,
    );
  }
}

function markerComment(
  marker: RunMarker,
  text: string,
): string {
  return `${formatMarker(marker)}\n**boardwright** · ${text}`;
}

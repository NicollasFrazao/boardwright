import type { RunOutcomeEvent } from '../domain/pipeline.ts';
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
  Issue,
  Logger,
  PullRequest,
} from './ports.ts';
import {
  hasFeedback,
  runFeedbackStage,
} from './feedback-stage.ts';
import {
  hasPlan,
  runRefineStage,
} from './refine-stage.ts';
import {
  isDecided,
  judge,
  runMergeStage,
  type MergeStageConfig,
  type MergeStageDependencies,
} from './merge-stage.ts';
import { runReviewStage } from './review-stage.ts';

const NO_PULL_REQUEST = 'no-pull-request';

/** Why a stage does not apply to an item right now. */
export type StagePrecondition = 'no-pull-request' | 'no-feedback' | 'merge-waiting' | 'merge-not-opted-in';

/**
 * What the loop needs to know about one stage: when it applies, when its work is already in place, how
 * it runs and where the card goes.
 *
 * @remarks
 * `undefined` for a Status means the stage leaves the card where it is.
 */
export interface StageHandler {
  readonly claimStatus: string | undefined;

  /** Where a card goes when the last run succeeded and its result is still in place. */
  readonly repairStatus: string | undefined;
  readonly giveUpStatus: string | undefined;
  precondition(issue: Issue): Promise<StagePrecondition | undefined>;

  /** Whether the result of the last successful run still stands (an open pull request, a review of the head). */
  isResultInPlace(issue: Issue): Promise<boolean>;
  run(issue: Issue): Promise<StageOutcome>;
  statusAfter(event: RunOutcomeEvent): string | undefined;
}

/** The handler of a configured stage. */
export function handlerFor(
  dependencies: ImplementStageDependencies & MergeStageDependencies & {
    readonly config: PipelineConfig;
    readonly logger: Logger;
  },
  stage: StageConfig,
): StageHandler {
  const limits = stageLimits(
    dependencies.config,
    stage,
  );

  const run = {
    deniedPaths: dependencies.config.guardRails.deniedPaths,
    maxTurns: limits.maxTurns,
    timeoutMs: limits.timeoutMs,
    model: dependencies.config.provider.model,
  };

  const openPullRequest = (issue: Issue): Promise<PullRequest | undefined> => dependencies.repoHost.findOpenPullRequest(
    issue.ref.repository,
    implementBranch(issue.ref.number),
  );

  switch (stage.id) {
    case 'implement':
      return {
        claimStatus: stage.claim.status,
        repairStatus: stage.done.status,
        giveUpStatus: stage.blocked.status,
        precondition: () => Promise.resolve(undefined),
        isResultInPlace: async (issue) => await openPullRequest(issue) !== undefined,
        run: (issue) => runImplementStage(
          dependencies,
          {
            ...run,
            stage,
            issue,
          },
        ),
        statusAfter: (event) => movingStatusAfter(
          stage,
          event,
        ),
      };
    case 'review':
      return {
        claimStatus: undefined,
        repairStatus: undefined,
        giveUpStatus: undefined,
        precondition: async (issue) => await openPullRequest(issue) === undefined ? NO_PULL_REQUEST : undefined,
        isResultInPlace: async (issue) => {
          const pullRequest = await openPullRequest(issue);

          return pullRequest !== undefined && dependencies.repoHost.hasAgentReview(
            issue.ref.repository,
            pullRequest.number,
            pullRequest.headSha,
          );
        },
        run: (issue) => runReviewStage(
          dependencies,
          {
            ...run,
            stage,
            issue,
          },
        ),
        statusAfter: () => undefined,
      };
    case 'refine':
      return {
        claimStatus: undefined,
        repairStatus: stage.done.status,
        giveUpStatus: stage.blocked.status,
        precondition: () => Promise.resolve(undefined),
        isResultInPlace: (issue) => hasPlan(
          dependencies.repoHost,
          issue,
        ),
        run: (issue) => runRefineStage(
          dependencies,
          {
            ...run,
            stage,
            issue,
          },
        ),
        statusAfter: (event) => movingStatusAfter(
          stage,
          event,
        ),
      };
    case 'merge':
      return mergeHandler(
        dependencies,
        stage,
      );
    case 'address-feedback':
      return {
        claimStatus: undefined,
        repairStatus: undefined,
        giveUpStatus: undefined,
        precondition: async (issue) => {
          const pullRequest = await openPullRequest(issue);

          if (pullRequest === undefined) {
            return NO_PULL_REQUEST;
          }

          return hasFeedback(await dependencies.repoHost.getFeedback(
            issue.ref.repository,
            pullRequest.number,
          )) ? undefined : 'no-feedback';
        },
        isResultInPlace: () => Promise.resolve(false),
        run: (issue) => runFeedbackStage(
          dependencies,
          {
            ...run,
            stage,
            issue,
          },
        ),
        statusAfter: () => undefined,
      };
  }
}

function mergeHandler(
  dependencies: MergeStageDependencies & { readonly logger: Logger },
  stage: MergeStageConfig,
): StageHandler {
  return {
    claimStatus: undefined,
    repairStatus: undefined,
    giveUpStatus: undefined,
    precondition: async (issue) => {
      const judgement = await judge(
        dependencies,
        stage,
        issue,
      );

      if (judgement === undefined) {
        return NO_PULL_REQUEST;
      }

      const {
        decision,
        failures,
      } = judgement.evaluation;

      if (
        decision === 'waiting'
        || decision === 'not-opted-in'
      ) {
        dependencies.logger.info(
          'merge.policy',
          {
            issue: `${issue.ref.repository}#${issue.ref.number}`,
            decision,
            failures: failures.map((failure) => failure.code),
          },
        );

        return decision === 'waiting' ? 'merge-waiting' : 'merge-not-opted-in';
      }

      return undefined;
    },
    isResultInPlace: async (issue) => {
      const judgement = await judge(
        dependencies,
        stage,
        issue,
      );

      return judgement !== undefined && isDecided(
        dependencies,
        judgement,
        issue,
      );
    },
    run: (issue) => runMergeStage(
      dependencies,
      stage,
      issue,
    ),
    statusAfter: () => undefined,
  };
}

/** The Status a card-moving stage reads and sends cards to. */
interface MovingStage {
  readonly when: { readonly status: string };
  readonly done: { readonly status: string };
  readonly blocked: { readonly status: string };
}

/** Where a card-moving stage (implement, refine) sends a card: forward on success, back on failure, to a person otherwise. */
function movingStatusAfter(
  stage: MovingStage,
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

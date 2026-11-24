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
  PullRequest,
} from './ports.ts';
import { runReviewStage } from './review-stage.ts';

/** Why a stage does not apply to an item right now. */
export type StagePrecondition = 'no-pull-request';

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
  dependencies: ImplementStageDependencies & { readonly config: PipelineConfig },
  stage: StageConfig,
): StageHandler {
  const limits = stageLimits(
    dependencies.config,
    stage,
  );

  const run = {
    stage,
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
            issue,
          },
        ),
        statusAfter: (event) => implementStatusAfter(
          stage,
          event,
        ),
      };
    case 'review':
      return {
        claimStatus: undefined,
        repairStatus: undefined,
        giveUpStatus: undefined,
        precondition: async (issue) => await openPullRequest(issue) === undefined ? 'no-pull-request' : undefined,
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
            issue,
          },
        ),
        statusAfter: () => undefined,
      };
  }
}

/** Where the implement stage sends a card: forward on success, back on failure, to a person otherwise. */
function implementStatusAfter(
  stage: Extract<StageConfig, { id: 'implement' }>,
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

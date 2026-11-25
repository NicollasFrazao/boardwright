import { formatReviewMarker } from '../domain/review-marker.ts';
import type { StageConfig } from './config.ts';
import {
  implementBranch,
  selectAgent,
  type ImplementStageDependencies,
  type StageOutcome,
} from './implement-stage.ts';
import type {
  Issue,
  PullRequest,
  ReviewComment,
} from './ports.ts';
import { buildReviewPrompt } from './prompt.ts';

/** One run of the review stage. */
export interface ReviewRun {
  readonly issue: Issue;
  readonly stage: StageConfig;
  readonly deniedPaths: readonly string[];
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly model: string | undefined;
}

/**
 * Runs the review stage: an agent reads the pull request of the issue's branch in a worktree and the
 * pipeline posts its verdict and line comments as a review that only comments.
 *
 * @remarks
 * The review never approves: approval is a person's, and merging is the merge policy's (ADR 0003). The
 * verdict is recorded for the head commit in the review's marker.
 */
export async function runReviewStage(
  dependencies: ImplementStageDependencies,
  run: ReviewRun,
): Promise<StageOutcome> {
  const repository = run.issue.ref.repository;
  const branch = implementBranch(run.issue.ref.number);

  const pullRequest = await dependencies.repoHost.findOpenPullRequest(
    repository,
    branch,
  );

  if (pullRequest === undefined) {
    return outcome(
      'failed',
      `There is no open pull request from ${branch} to review.`,
    );
  }

  const workspace = await dependencies.workspaces.prepare({
    repository,
    branch,
    base: await dependencies.repoHost.getDefaultBranch(repository),
  });

  try {
    const context = await dependencies.context.load(
      workspace.path,
      {
        phase: run.stage.context.phase,
        agent: selectAgent(
          run.stage,
          run.issue.labels,
        ),
      },
    );

    const result = await dependencies.agent.run({
      stage: run.stage.id,
      task: 'review',
      cwd: workspace.path,
      prompt: buildReviewPrompt({
        issue: run.issue,
        pullRequest,
        workspace,
        context,
      }),
      maxTurns: run.maxTurns,
      timeoutMs: run.timeoutMs,
      deniedPaths: run.deniedPaths,
      model: run.model,
    });

    if (result.status !== 'completed') {
      return outcome(
        result.status,
        result.summary,
      );
    }

    if (result.review === undefined) {
      return outcome(
        'failed',
        'The agent finished without a verdict.',
      );
    }

    await postReview(
      dependencies,
      pullRequest,
      repository,
      {
        ...result.review,
        summary: result.summary,
      },
    );

    return outcome(
      'succeeded',
      `Reviewed ${pullRequest.url}: ${result.review.verdict === 'approve' ? 'no changes needed' : 'changes needed'}.`,
    );
  } finally {
    await dependencies.workspaces.dispose(workspace);
  }
}

async function postReview(
  dependencies: ImplementStageDependencies,
  pullRequest: PullRequest,
  repository: string,
  review: {
    readonly verdict: 'approve' | 'changes';
    readonly summary: string;
    readonly comments: readonly ReviewComment[];
  },
): Promise<void> {
  const heading = review.verdict === 'approve' ? 'no changes needed' : 'changes needed';

  await dependencies.repoHost.submitReview({
    repository,
    number: pullRequest.number,
    headSha: pullRequest.headSha,
    body: `${formatReviewMarker({
      verdict: review.verdict,
      headSha: pullRequest.headSha,
    })}\n**boardwright review** · ${heading}\n\n${review.summary}`,
    comments: review.comments,
  });
}

function outcome(
  event: StageOutcome['event'],
  detail: string,
): StageOutcome {
  return {
    event,
    detail,
    pullRequest: undefined,
  };
}

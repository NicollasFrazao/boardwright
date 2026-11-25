import {
  implementBranch,
  selectAgent,
  type ImplementRun,
  type ImplementStageDependencies,
  type StageOutcome,
} from './implement-stage.ts';
import type {
  Issue,
  RepoHostPort,
} from './ports.ts';
import { buildPlanPrompt } from './prompt.ts';

/** The hidden marker that starts a plan comment; deleting the comment asks for a new plan. */
export const PLAN_MARKER = '<!-- boardwright:plan v=1 -->';

/** Whether the issue still carries a plan the pipeline posted. */
export async function hasPlan(
  repoHost: RepoHostPort,
  issue: Issue,
): Promise<boolean> {
  const comments = await repoHost.listComments(issue.ref);

  return comments.some((comment) => comment.body.startsWith(PLAN_MARKER));
}

/**
 * Runs the refine stage: an agent reads the repository and the issue and writes a plan, which the
 * pipeline posts as a comment on the issue.
 *
 * @remarks
 * The plan is a comment, not a file: the portfolio repositories ignore `.context/plans/` as dotcontext's
 * local state, so a plan written there would never reach a pull request. The worktree is only read.
 */
export async function runRefineStage(
  dependencies: ImplementStageDependencies,
  run: ImplementRun,
): Promise<StageOutcome> {
  const repository = run.issue.ref.repository;

  const workspace = await dependencies.workspaces.prepare({
    repository,
    branch: implementBranch(run.issue.ref.number),
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
      task: 'plan',
      cwd: workspace.path,
      prompt: buildPlanPrompt({
        issue: run.issue,
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

    const plan = result.plan?.trim() ?? '';

    if (plan === '') {
      return outcome(
        'failed',
        'The agent finished without a plan.',
      );
    }

    await dependencies.repoHost.addComment(
      run.issue.ref,
      `${PLAN_MARKER}\n**boardwright plan** for #${run.issue.ref.number}\n\n${plan}`,
    );

    return outcome(
      'succeeded',
      'Posted the plan on the issue.',
    );
  } finally {
    await dependencies.workspaces.dispose(workspace);
  }
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

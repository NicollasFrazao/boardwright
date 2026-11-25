import {
  evaluateMergePolicy,
  failureKey,
  formatMergeMarker,
  parseMergeMarker,
  type MergeEvaluation,
  type MergeFacts,
  type MergePolicy,
} from '../domain/merge-policy.ts';
import type { StageConfig } from './config.ts';
import {
  implementBranch,
  selectAgent,
  type ImplementStageDependencies,
  type StageOutcome,
} from './implement-stage.ts';
import type {
  Issue,
  MergerPort,
  PullRequest,
  RepoHostPort,
} from './ports.ts';
import { buildGatekeeperPrompt } from './prompt.ts';

/** The merge stage of a validated configuration. */
export type MergeStageConfig = Extract<StageConfig, { id: 'merge' }>;

/** What the merge stage reads and acts through. */
export interface MergeStageDependencies extends ImplementStageDependencies {
  readonly repoHost: RepoHostPort;
  readonly merger: MergerPort;
}

/** The limits of the gatekeeper's session, as for any agent stage. */
export interface GatekeeperLimits {
  readonly deniedPaths: readonly string[];
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly model: string | undefined;
}

/** The failure key of a gatekeeper veto; a vetoed head is not asked again. */
const VETO_KEY = 'gatekeeper-veto';

/** A pull request judged by the policy. */
export interface MergeJudgement {
  readonly pullRequest: PullRequest;
  readonly facts: MergeFacts;
  readonly evaluation: MergeEvaluation;
}

/** The policy a merge stage configures. */
export function policyOf(stage: MergeStageConfig): MergePolicy {
  return {
    requireAgentApproval: stage.require.agentApproval,
    maxChangedLines: stage.require.maxChangedLines,
    deniedPaths: stage.require.deniedPaths,
    optInLabel: stage.require.optInLabel ?? undefined,
    optOutLabel: stage.require.optOutLabel,
  };
}

/** Reads the pull request of the issue's branch and evaluates the policy; `undefined` without one. */
export async function judge(
  dependencies: MergeStageDependencies,
  stage: MergeStageConfig,
  issue: Issue,
): Promise<MergeJudgement | undefined> {
  const repository = issue.ref.repository;

  const pullRequest = await dependencies.repoHost.findOpenPullRequest(
    repository,
    implementBranch(issue.ref.number),
  );

  if (pullRequest === undefined) {
    return undefined;
  }

  const facts = await dependencies.repoHost.getMergeFacts(
    repository,
    pullRequest.number,
  );

  return {
    pullRequest,
    facts,
    evaluation: evaluateMergePolicy(
      facts,
      policyOf(stage),
    ),
  };
}

/**
 * Whether the current situation was already decided: auto-merge is on, or an audit comment exists for
 * this head with the same decision and failures.
 */
export async function isDecided(
  dependencies: MergeStageDependencies,
  judgement: MergeJudgement,
  issue: Issue,
): Promise<boolean> {
  if (judgement.facts.isAutoMergeEnabled) {
    return true;
  }

  const comments = await dependencies.repoHost.listComments({
    repository: issue.ref.repository,
    number: judgement.pullRequest.number,
  });

  const keys = judgement.evaluation.decision === 'pass'
    ? [
        'pass',
        VETO_KEY,
      ]
    : [keyOf(judgement.evaluation)];

  return comments.some((comment) => {
    const marker = parseMergeMarker(comment.body);

    return marker?.headSha === judgement.facts.headSha && keys.includes(marker.key);
  });
}

/**
 * Runs the merge stage: reads the pull request again, re-evaluates the policy right before acting, and
 * merges (or turns on native auto-merge) when it passes, or explains once why it did not.
 *
 * @remarks
 * Waiting states (checks running, no review of the head yet) and a pull request without the opt-in label
 * write nothing, so the pipeline never comments on every tick.
 */
export async function runMergeStage(
  dependencies: MergeStageDependencies,
  stage: MergeStageConfig,
  issue: Issue,
  limits: GatekeeperLimits,
): Promise<StageOutcome> {
  const judgement = await judge(
    dependencies,
    stage,
    issue,
  );

  if (judgement === undefined) {
    return outcome(
      'failed',
      'There is no open pull request from the issue\'s branch.',
    );
  }

  const {
    pullRequest,
    facts,
    evaluation,
  } = judgement;

  const target = {
    repository: issue.ref.repository,
    number: pullRequest.number,
  };

  switch (evaluation.decision) {
    case 'pass': {
      if (stage.mode === 'agent') {
        const stop = await askGatekeeper(
          dependencies,
          {
            stage,
            issue,
            judgement,
            limits,
          },
        );

        if (stop !== undefined) {
          return stop;
        }
      }

      const result = await dependencies.merger.merge({
        ...target,
        pullRequestId: facts.pullRequestId,
        headSha: facts.headSha,
        method: stage.method,
      });

      await dependencies.repoHost.addComment(
        target,
        auditComment(
          facts,
          result,
          evaluation,
          stage,
        ),
      );

      return outcome(
        'succeeded',
        result === 'merged' ? `Merged ${pullRequest.url}.` : `Turned on auto-merge for ${pullRequest.url}; GitHub merges it once the ruleset allows.`,
      );
    }

    case 'blocked':
      await dependencies.repoHost.addComment(
        target,
        auditComment(
          facts,
          'blocked',
          evaluation,
          stage,
        ),
      );

      return outcome(
        'succeeded',
        `Did not merge ${pullRequest.url}: ${evaluation.failures.map((failure) => failure.code).join(', ')}.`,
      );
    case 'waiting':
    case 'not-opted-in':
      return outcome(
        'succeeded',
        `Nothing to do for ${pullRequest.url} yet (${evaluation.decision}).`,
      );
  }
}

/**
 * Asks the gatekeeper agent whether merging without a person is safe; `undefined` lets the merge go on.
 *
 * @remarks
 * The gatekeeper runs only after the policy passed, so its approval can never override a failed condition:
 * it can veto, never force. The policy is judged again after it, because a session takes minutes and the
 * pull request may have changed meanwhile.
 */
async function askGatekeeper(
  dependencies: MergeStageDependencies,
  ask: {
    readonly stage: MergeStageConfig;
    readonly issue: Issue;
    readonly judgement: MergeJudgement;
    readonly limits: GatekeeperLimits;
  },
): Promise<StageOutcome | undefined> {
  const {
    stage,
    issue,
    judgement,
  } = ask;

  const repository = issue.ref.repository;

  const workspace = await dependencies.workspaces.prepare({
    repository,
    branch: implementBranch(issue.ref.number),
    base: await dependencies.repoHost.getDefaultBranch(repository),
  });

  let result;

  try {
    result = await dependencies.agent.run({
      stage: stage.id,
      task: 'review',
      cwd: workspace.path,
      prompt: buildGatekeeperPrompt({
        issue,
        pullRequest: judgement.pullRequest,
        workspace,
        context: await dependencies.context.load(
          workspace.path,
          {
            phase: stage.context.phase,
            agent: selectAgent(
              stage,
              issue.labels,
            ),
          },
        ),
      }),
      ...ask.limits,
    });
  } finally {
    await dependencies.workspaces.dispose(workspace);
  }

  if (result.status !== 'completed') {
    return outcome(
      result.status,
      result.summary,
    );
  }

  if (result.review === undefined) {
    return outcome(
      'failed',
      'The gatekeeper finished without a verdict.',
    );
  }

  if (result.review.verdict === 'changes') {
    await dependencies.repoHost.addComment(
      {
        repository,
        number: judgement.pullRequest.number,
      },
      vetoComment(
        judgement.facts,
        result.summary,
      ),
    );

    return outcome(
      'succeeded',
      `The gatekeeper vetoed merging ${judgement.pullRequest.url}.`,
    );
  }

  const again = await judge(
    dependencies,
    stage,
    issue,
  );

  return again?.evaluation.decision === 'pass' && again.facts.headSha === judgement.facts.headSha
    ? undefined
    : outcome(
        'succeeded',
        `${judgement.pullRequest.url} changed while the gatekeeper ran; nothing was merged.`,
      );
}

function vetoComment(
  facts: MergeFacts,
  summary: string,
): string {
  return [
    formatMergeMarker({
      headSha: facts.headSha,
      decision: 'blocked',
      key: VETO_KEY,
    }),
    `**boardwright merge** · vetoed by the gatekeeper at \`${facts.headSha.slice(
      0,
      HEAD_DISPLAY_LENGTH,
    )}\``,
    '',
    summary,
    '',
    'Every policy condition passed; the gatekeeper found a reason for a person to merge it. The pipeline looks again after the next push.',
  ].join('\n');
}

function keyOf(evaluation: MergeEvaluation): string {
  return evaluation.decision === 'pass' ? 'pass' : failureKey(evaluation.failures);
}

function auditComment(
  facts: MergeFacts,
  decision: 'merged' | 'auto-merge' | 'blocked',
  evaluation: MergeEvaluation,
  stage: MergeStageConfig,
): string {
  const marker = formatMergeMarker({
    headSha: facts.headSha,
    decision,
    key: keyOf(evaluation),
  });

  const head = facts.headSha.slice(
    0,
    HEAD_DISPLAY_LENGTH,
  );

  if (decision === 'blocked') {
    return [
      marker,
      `**boardwright merge** · not merged at \`${head}\``,
      '',
      ...evaluation.failures.map((failure) => `- ${failure.detail}`),
      '',
      'Fix these, or merge it by hand. The pipeline looks again after the next push or change.',
    ].join('\n');
  }

  return [
    marker,
    `**boardwright merge** · ${decision === 'merged' ? 'merged' : 'auto-merge turned on'} at \`${head}\``,
    '',
    `Every condition passed: ${passedConditions(
      facts,
      stage,
    ).join(', ')}.`,
  ].join('\n');
}

const HEAD_DISPLAY_LENGTH = 7;

function passedConditions(
  facts: MergeFacts,
  stage: MergeStageConfig,
): string[] {
  const conditions = [
    'checks passing',
    'no unresolved threads',
  ];

  if (stage.require.agentApproval) {
    conditions.push('the review of this head approves');
  }

  conditions.push(
    `${facts.changedLines} changed lines (limit ${stage.require.maxChangedLines})`,
    'no path from the merge denylist',
  );

  if (stage.require.optInLabel !== null) {
    conditions.push(`labelled \`${stage.require.optInLabel}\``);
  }

  return conditions;
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

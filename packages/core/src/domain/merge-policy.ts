import { posix } from 'node:path';
import type { ReviewVerdict } from './review-marker.ts';

/** The state of the head commit's checks, as GitHub rolls them up. */
export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

/** Whether GitHub can merge the pull request as it stands. */
export type Mergeability = 'mergeable' | 'conflicting' | 'unknown';

/** Everything the merge policy looks at, read from the pull request right before deciding. */
export interface MergeFacts {
  readonly pullRequestId: string;
  readonly headSha: string;
  readonly isDraft: boolean;
  readonly labels: readonly string[];
  readonly checks: ChecksState;
  readonly mergeability: Mergeability;
  readonly unresolvedThreads: number;

  /** The pipeline's review verdict for the head commit; `undefined` when it has not reviewed this head. */
  readonly agentVerdict: ReviewVerdict | undefined;
  readonly changedLines: number;
  readonly changedPaths: readonly string[];
  readonly isAutoMergeEnabled: boolean;
}

/** The conditions a board owner sets for the pipeline to merge. */
export interface MergePolicy {
  readonly requireAgentApproval: boolean;
  readonly maxChangedLines: number;
  readonly deniedPaths: readonly string[];

  /** A label the pull request must carry; `undefined` merges without one. */
  readonly optInLabel: string | undefined;

  /** A label that always stops the pipeline from merging. */
  readonly optOutLabel: string;
}

/** One reason the policy did not pass. */
export interface PolicyFailure {
  readonly code: string;
  readonly detail: string;
}

/**
 * What the policy decided.
 *
 * - `pass`: every condition holds; merge.
 * - `blocked`: a condition fails that a person or a new push must change; say why, once.
 * - `waiting`: something is still settling (checks running, no review of this head yet); look again later, quietly.
 * - `not-opted-in`: the pull request does not carry the opt-in label; leave it alone, quietly.
 */
export interface MergeEvaluation {
  readonly decision: 'pass' | 'blocked' | 'waiting' | 'not-opted-in';
  readonly failures: readonly PolicyFailure[];
}

/**
 * Evaluates the merge policy: deterministic code, the same for every provider (ADR 0003).
 *
 * @remarks
 * The opt-out label wins over everything, including the opt-in label. Waiting is checked before
 * blocking only for states that settle on their own, so a pull request is never reported as blocked
 * merely because its checks are still running.
 */
export function evaluateMergePolicy(
  facts: MergeFacts,
  policy: MergePolicy,
): MergeEvaluation {
  if (facts.labels.includes(policy.optOutLabel)) {
    return blocked([
      {
        code: 'opted-out',
        detail: `The pull request is labelled \`${policy.optOutLabel}\`: a person merges it.`,
      },
    ]);
  }

  if (
    policy.optInLabel !== undefined
    && !facts.labels.includes(policy.optInLabel)
  ) {
    return {
      decision: 'not-opted-in',
      failures: [],
    };
  }

  const failures = blockingFailures(
    facts,
    policy,
  );

  if (failures.length > 0) {
    return blocked(failures);
  }

  const waiting = waitingFailures(
    facts,
    policy,
  );

  return waiting.length > 0
    ? {
        decision: 'waiting',
        failures: waiting,
      }
    : {
        decision: 'pass',
        failures: [],
      };
}

/** A stable key for a set of failures, so the same block is reported once. */
export function failureKey(failures: readonly PolicyFailure[]): string {
  return failures.map((failure) => failure.code).sort((
    left,
    right,
  ) => left.localeCompare(right)).join('+');
}

function blockingFailures(
  facts: MergeFacts,
  policy: MergePolicy,
): PolicyFailure[] {
  const failures: PolicyFailure[] = [];

  const denied = facts.changedPaths.filter((path) => policy.deniedPaths.some((pattern) => posix.matchesGlob(
    path,
    pattern,
  )));

  if (facts.isDraft) {
    failures.push(failure(
      'draft',
      'The pull request is a draft.',
    ));
  }

  if (facts.mergeability === 'conflicting') {
    failures.push(failure(
      'conflicts',
      'The pull request conflicts with its base branch.',
    ));
  }

  if (facts.checks === 'failing') {
    failures.push(failure(
      'checks-failing',
      'Checks of the head commit failed.',
    ));
  }

  if (facts.unresolvedThreads > 0) {
    failures.push(failure(
      'unresolved-threads',
      `${facts.unresolvedThreads} review threads are unresolved.`,
    ));
  }

  if (
    policy.requireAgentApproval
    && facts.agentVerdict === 'changes'
  ) {
    failures.push(failure(
      'review-changes',
      'The review of the head commit asks for changes.',
    ));
  }

  if (facts.changedLines > policy.maxChangedLines) {
    failures.push(failure(
      'too-large',
      `${facts.changedLines} changed lines exceed the limit of ${policy.maxChangedLines}.`,
    ));
  }

  if (denied.length > 0) {
    failures.push(failure(
      'denied-paths',
      `It changes paths only a person merges: ${denied.join(', ')}.`,
    ));
  }

  return failures;
}

function waitingFailures(
  facts: MergeFacts,
  policy: MergePolicy,
): PolicyFailure[] {
  const failures: PolicyFailure[] = [];

  if (
    facts.checks === 'pending'
    || facts.checks === 'none'
  ) {
    failures.push(failure(
      'checks-pending',
      'Checks of the head commit have not all passed yet.',
    ));
  }

  if (facts.mergeability === 'unknown') {
    failures.push(failure(
      'mergeability-unknown',
      'GitHub has not computed whether it can merge yet.',
    ));
  }

  if (
    policy.requireAgentApproval
    && facts.agentVerdict === undefined
  ) {
    failures.push(failure(
      'review-missing',
      'The head commit has no review from the pipeline yet.',
    ));
  }

  return failures;
}

function failure(
  code: string,
  detail: string,
): PolicyFailure {
  return {
    code,
    detail,
  };
}

function blocked(failures: PolicyFailure[]): MergeEvaluation {
  return {
    decision: 'blocked',
    failures,
  };
}

const MERGE_MARKER_VERSION = 1;

const MERGE_MARKER_PATTERN = /<!-- boardwright:merge v=(?<version>\d+) head=(?<head>[0-9a-f]{7,64}) decision=(?<decision>[a-z-]+) key=(?<key>[a-z+-]*) -->/u;

/** The marker of a merge audit comment: which head was judged, the decision and the failure key. */
export interface MergeMarker {
  readonly headSha: string;
  readonly decision: 'merged' | 'auto-merge' | 'blocked';
  readonly key: string;
}

/** Writes the hidden marker that starts a merge audit comment; a public contract like the run marker. */
export function formatMergeMarker(marker: MergeMarker): string {
  return `<!-- boardwright:merge v=${MERGE_MARKER_VERSION} head=${marker.headSha} decision=${marker.decision} key=${marker.key} -->`;
}

/** Reads a merge audit marker; `undefined` when there is none or it is unknown. */
export function parseMergeMarker(body: string): MergeMarker | undefined {
  const groups = MERGE_MARKER_PATTERN.exec(body)?.groups;
  const decision = groups?.decision;

  if (
    groups?.version !== String(MERGE_MARKER_VERSION)
    || groups.head === undefined
    || groups.key === undefined
    || (decision !== 'merged'
    && decision !== 'auto-merge'
    && decision !== 'blocked')
  ) {
    return undefined;
  }

  return {
    headSha: groups.head,
    decision,
    key: groups.key,
  };
}

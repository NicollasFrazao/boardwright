import type { RecordedMarker } from './run-marker.ts';

/** What the next tick should do for one stage of one item, judged from its markers alone. */
export type RunDecision =
  | {
    readonly kind: 'start';
    readonly attempt: number;
  }
  | {
    readonly kind: 'in-flight';
    readonly runId: string;
  }
  | {
    readonly kind: 'repair';
    readonly runId: string;
  }
  | {
    readonly kind: 'give-up';
    readonly attempts: number;
  }
  | { readonly kind: 'given-up' };

/** The limits a decision respects. */
export interface RunLimits {
  readonly maxAttempts: number;

  /** After this long without an outcome, a started run is presumed dead and counts as failed. */
  readonly staleAfterMs: number;
}

/** Facts outside the markers that a decision needs. */
export interface RunFacts {
  readonly now: Date;

  /** Whether the result of the last successful run is still in place (for example, its pull request is open). */
  readonly isResultInPlace: boolean;
}

interface RunSummary {
  readonly runId: string;
  readonly attempt: number;
  readonly startedAt: Date;
  readonly hasOutcome: boolean;
  readonly hasSucceeded: boolean;
}

/**
 * Decides whether a stage should start, wait, repair the board or give up.
 *
 * @remarks
 * The attempt count is the highest attempt ever started, so a run that died without an outcome still
 * counts once it is stale. Giving up is final: only a person changes the config or the markers.
 */
export function decideRun(
  markers: readonly RecordedMarker[],
  facts: RunFacts,
  limits: RunLimits,
): RunDecision {
  if (markers.some((marker) => marker.event === 'gave-up')) {
    return { kind: 'given-up' };
  }

  const latest = latestRun(markers);

  if (latest === undefined) {
    return {
      kind: 'start',
      attempt: 1,
    };
  }

  if (isInFlight(
    latest,
    facts.now,
    limits.staleAfterMs,
  )) {
    return {
      kind: 'in-flight',
      runId: latest.runId,
    };
  }

  if (
    latest.hasSucceeded
    && facts.isResultInPlace
  ) {
    return {
      kind: 'repair',
      runId: latest.runId,
    };
  }

  if (latest.attempt >= limits.maxAttempts) {
    return {
      kind: 'give-up',
      attempts: latest.attempt,
    };
  }

  return {
    kind: 'start',
    attempt: latest.attempt + 1,
  };
}

/**
 * Whether `runId` won the claim for `attempt`: the earliest `started` marker of that attempt is its own.
 *
 * @remarks
 * Two runners can both write a `started` marker before either reads the other's. Re-reading the
 * markers after writing and keeping only the earliest claim makes exactly one of them go on.
 */
export function isClaimWinner(
  markers: readonly RecordedMarker[],
  runId: string,
  attempt: number,
): boolean {
  const firstClaim = markers.find((marker) => marker.event === 'started' && marker.attempt === attempt);

  return firstClaim?.runId === runId;
}

function isInFlight(
  run: RunSummary,
  now: Date,
  staleAfterMs: number,
): boolean {
  return !run.hasOutcome && now.getTime() - run.startedAt.getTime() < staleAfterMs;
}

function latestRun(markers: readonly RecordedMarker[]): RunSummary | undefined {
  let latest: RecordedMarker | undefined;

  for (const marker of markers) {
    if (
      marker.event === 'started'
      && (latest === undefined
      || marker.attempt > latest.attempt)
    ) {
      latest = marker;
    }
  }

  if (latest === undefined) {
    return undefined;
  }

  const runId = latest.runId;
  const outcomes = markers.filter((marker) => marker.runId === runId && marker.event !== 'started');

  return {
    runId,
    attempt: latest.attempt,
    startedAt: latest.recordedAt,
    hasOutcome: outcomes.length > 0,
    hasSucceeded: outcomes.some((marker) => marker.event === 'succeeded'),
  };
}

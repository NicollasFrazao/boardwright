import type {
  IssueComment,
  RunEvent,
} from './pipeline.ts';

/**
 * One line of a run's history, written as a hidden comment on the issue.
 *
 * @remarks
 * The marker is the pipeline's state (ADR 0001) and a public contract: runners of different versions
 * read the same board, so the format only changes with a new version number.
 */
export interface RunMarker {
  readonly stage: string;
  readonly runId: string;
  readonly attempt: number;
  readonly event: RunEvent;
}

/** A marker read back from a comment, with the time GitHub recorded it. */
export interface RecordedMarker extends RunMarker {
  readonly commentId: string;
  readonly recordedAt: Date;
}

const MARKER_VERSION = 1;

const MARKER_PATTERN = /<!-- boardwright:run v=(?<version>\d+) stage=(?<stage>[a-z-]+) run=(?<runId>[\w-]+) attempt=(?<attempt>\d+) event=(?<event>[a-z-]+) -->/u;

const RUN_EVENTS: ReadonlySet<string> = new Set<RunEvent>([
  'started',
  'succeeded',
  'failed',
  'blocked',
  'denied',
  'gave-up',
]);

function isRunEvent(value: string): value is RunEvent {
  return RUN_EVENTS.has(value);
}

/** Writes a marker as the hidden HTML comment that starts a marker comment. */
export function formatMarker(marker: RunMarker): string {
  return `<!-- boardwright:run v=${MARKER_VERSION} stage=${marker.stage} run=${marker.runId} attempt=${marker.attempt} event=${marker.event} -->`;
}

/** Reads the marker in a comment body; `undefined` when there is none or its version is unknown. */
export function parseMarker(body: string): RunMarker | undefined {
  const groups = MARKER_PATTERN.exec(body)?.groups;

  if (
    groups?.version !== String(MARKER_VERSION)
    || groups.stage === undefined
    || groups.runId === undefined
    || groups.attempt === undefined
    || groups.event === undefined
    || !isRunEvent(groups.event)
  ) {
    return undefined;
  }

  return {
    stage: groups.stage,
    runId: groups.runId,
    attempt: Number(groups.attempt),
    event: groups.event,
  };
}

/** The markers of one stage among an issue's comments, oldest first. */
export function readMarkers(
  comments: readonly IssueComment[],
  stage: string,
): RecordedMarker[] {
  const markers: RecordedMarker[] = [];

  for (const comment of comments) {
    const marker = parseMarker(comment.body);

    if (marker?.stage === stage) {
      markers.push({
        ...marker,
        commentId: comment.id,
        recordedAt: comment.createdAt,
      });
    }
  }

  return markers.sort(compareRecorded);
}

function compareRecorded(
  left: RecordedMarker,
  right: RecordedMarker,
): number {
  const byTime = left.recordedAt.getTime() - right.recordedAt.getTime();

  return byTime === 0 ? left.commentId.localeCompare(right.commentId) : byTime;
}

import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  decideRun,
  isClaimWinner,
  type RecordedMarker,
  type RunEvent,
} from '../src/index.ts';

const START = new Date('2026-11-24T12:00:00Z');
const MINUTE = 60_000;

const limits = {
  maxAttempts: 3,
  staleAfterMs: 65 * MINUTE,
};

function recorded(
  runId: string,
  attempt: number,
  event: RunEvent,
  minutesAfterStart = 0,
): RecordedMarker {
  return {
    stage: 'implement',
    runId,
    attempt,
    event,
    commentId: `${runId}-${event}`,
    recordedAt: new Date(START.getTime() + minutesAfterStart * MINUTE),
  };
}

function facts(
  minutesAfterStart: number,
  isResultInPlace = false,
): {
  now: Date;
  isResultInPlace: boolean;
} {
  return {
    now: new Date(START.getTime() + minutesAfterStart * MINUTE),
    isResultInPlace,
  };
}

describe('decideRun', () => {
  it('starts attempt 1 when the stage never ran', () => {
    expect(decideRun(
      [],
      facts(0),
      limits,
    )).toEqual({
      kind: 'start',
      attempt: 1,
    });
  });

  it('waits while a started run is younger than the stale limit', () => {
    expect(decideRun(
      [recorded(
        'run-1',
        1,
        'started',
      )],
      facts(30),
      limits,
    )).toEqual({
      kind: 'in-flight',
      runId: 'run-1',
    });
  });

  it('counts a silent run as failed once it is stale, and starts the next attempt', () => {
    expect(decideRun(
      [recorded(
        'run-1',
        1,
        'started',
      )],
      facts(66),
      limits,
    )).toEqual({
      kind: 'start',
      attempt: 2,
    });
  });

  it('starts the next attempt after a failure', () => {
    const markers = [
      recorded(
        'run-1',
        1,
        'started',
      ),
      recorded(
        'run-1',
        1,
        'failed',
        10,
      ),
    ];

    expect(decideRun(
      markers,
      facts(11),
      limits,
    )).toEqual({
      kind: 'start',
      attempt: 2,
    });
  });

  it('repairs the board when the last run succeeded and its result is still in place', () => {
    const markers = [
      recorded(
        'run-1',
        1,
        'started',
      ),
      recorded(
        'run-1',
        1,
        'succeeded',
        10,
      ),
    ];

    expect(decideRun(
      markers,
      facts(
        11,
        true,
      ),
      limits,
    )).toEqual({
      kind: 'repair',
      runId: 'run-1',
    });
  });

  it('runs again when a person brought back an item whose result is gone', () => {
    const markers = [
      recorded(
        'run-1',
        1,
        'started',
      ),
      recorded(
        'run-1',
        1,
        'succeeded',
        10,
      ),
    ];

    expect(decideRun(
      markers,
      facts(
        11,
        false,
      ),
      limits,
    )).toEqual({
      kind: 'start',
      attempt: 2,
    });
  });

  it('gives up when the last allowed attempt has ended', () => {
    const markers = [
      recorded(
        'run-3',
        3,
        'started',
      ),
      recorded(
        'run-3',
        3,
        'denied',
        5,
      ),
    ];

    expect(decideRun(
      markers,
      facts(6),
      limits,
    )).toEqual({
      kind: 'give-up',
      attempts: 3,
    });
  });

  it('stays given up for good', () => {
    const markers = [
      recorded(
        'run-1',
        1,
        'started',
      ),
      recorded(
        'run-1',
        1,
        'failed',
        1,
      ),
      recorded(
        'run-x',
        1,
        'gave-up',
        2,
      ),
    ];

    expect(decideRun(
      markers,
      facts(3),
      limits,
    )).toEqual({ kind: 'given-up' });
  });
});

describe('isClaimWinner', () => {
  const markers = [
    recorded(
      'run-a',
      2,
      'started',
      1,
    ),
    recorded(
      'run-b',
      2,
      'started',
      1,
    ),
    recorded(
      'run-old',
      1,
      'started',
      0,
    ),
  ];

  it('gives the claim to the earliest started marker of the attempt', () => {
    expect(isClaimWinner(
      markers,
      'run-a',
      2,
    )).toBe(true);

    expect(isClaimWinner(
      markers,
      'run-b',
      2,
    )).toBe(false);
  });

  it('never gives an attempt to a run that did not claim it', () => {
    expect(isClaimWinner(
      markers,
      'run-a',
      3,
    )).toBe(false);
  });
});

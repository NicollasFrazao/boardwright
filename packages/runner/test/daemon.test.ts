import type { TickReport } from '@boardwright/core';
import { MemoryLogger } from '@boardwright/testing';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  runDaemon,
  sleep,
  summarize,
  waitAfter,
} from '../src/daemon.ts';

const ISSUE = {
  repository: 'acme/app',
  number: 7,
};

const REPORT: TickReport = {
  board: [],
  entries: [
    {
      stage: 'implement',
      itemId: 'item-7',
      issue: ISSUE,
      action: {
        kind: 'run',
        attempt: 1,
      },
      result: {
        kind: 'error',
        message: 'GitHub is down',
      },
    },
    {
      stage: 'implement',
      itemId: 'item-8',
      issue: ISSUE,
      action: {
        kind: 'skip',
        reason: 'not-triggered',
      },
      result: undefined,
    },
  ],
};

describe('runDaemon', () => {
  it('waits the interval between ticks, backs off while ticks throw, and resets after a success', async () => {
    const controller = new AbortController();

    const outcomes = [
      'ok',
      'throw',
      'throw',
      'throw',
      'ok',
    ];

    const waits: number[] = [];
    const logger = new MemoryLogger();

    const ticks = await runDaemon({
      intervalMs: 60_000,
      maxBackoffMs: 300_000,
      signal: controller.signal,
      logger,
      tick: () => outcomes.shift() === 'throw' ? Promise.reject(new Error('GitHub is down')) : Promise.resolve(REPORT),
      sleep: (ms) => {
        waits.push(ms);

        if (outcomes.length === 0) {
          controller.abort();
        }

        return Promise.resolve();
      },
    });

    expect(ticks).toBe(2);

    expect(waits).toEqual([
      60_000,
      120_000,
      240_000,
      300_000,
      60_000,
    ]);

    expect(logger.entries.filter((entry) => entry.level === 'warn').map((entry) => entry.event)).toEqual([
      'daemon.tick-failed',
      'daemon.tick-failed',
      'daemon.tick-failed',
    ]);

    expect(logger.entries.at(-1)).toMatchObject({
      event: 'daemon.stopped',
      fields: { ticks: 2 },
    });
  });

  it('finishes the tick it is in when the signal aborts, and does not wait after it', async () => {
    const controller = new AbortController();
    let sleeps = 0;

    const ticks = await runDaemon({
      intervalMs: 60_000,
      maxBackoffMs: 300_000,
      signal: controller.signal,
      logger: new MemoryLogger(),
      tick: () => {
        controller.abort();

        return Promise.resolve(REPORT);
      },
      sleep: () => {
        sleeps += 1;

        return Promise.resolve();
      },
    });

    expect(ticks).toBe(1);
    expect(sleeps).toBe(0);
  });

  it('does not start when the signal already aborted', async () => {
    const controller = new AbortController();

    controller.abort();

    expect(await runDaemon({
      intervalMs: 1,
      maxBackoffMs: 1,
      signal: controller.signal,
      logger: new MemoryLogger(),
      tick: () => Promise.reject(new Error('never')),
      sleep: () => Promise.resolve(),
    })).toBe(0);
  });
});

describe('daemon helpers', () => {
  it('caps the backoff', () => {
    expect([
      0,
      1,
      2,
      10,
    ].map((failures) => waitAfter(
      failures,
      {
        intervalMs: 10,
        maxBackoffMs: 50,
      },
    ))).toEqual([
      10,
      20,
      40,
      50,
    ]);
  });

  it('counts a tick by action kind, errors apart', () => {
    expect(summarize(REPORT)).toEqual({
      error: 1,
      skip: 1,
    });
  });

  it('counts board hygiene apart from the stages', () => {
    expect(summarize({
      board: [
        {
          action: {
            kind: 'add-issue',
            issue: ISSUE,
          },
          result: { kind: 'applied' },
        },
        {
          action: {
            kind: 'add-issue',
            issue: ISSUE,
          },
          result: {
            kind: 'error',
            message: 'denied',
          },
        },
      ],
      entries: [],
    })).toEqual({
      'board.add-issue': 1,
      error: 1,
    });
  });

  it('sleeps, and ends early and quietly when the signal aborts', async () => {
    const controller = new AbortController();
    const started = performance.now();

    const waiting = sleep(
      60_000,
      controller.signal,
    );

    controller.abort();
    await waiting;

    expect(performance.now() - started).toBeLessThan(1000);

    await sleep(
      1,
      new AbortController().signal,
    );
  });
});

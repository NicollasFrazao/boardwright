import { setTimeout as delay } from 'node:timers/promises';
import type {
  Logger,
  TickReport,
} from '@boardwright/core';

/** How the daemon paces itself and when it stops. */
export interface DaemonOptions {
  readonly intervalMs: number;

  /** The longest wait after repeated failures. */
  readonly maxBackoffMs: number;

  /** Aborted on SIGINT or SIGTERM: the current tick finishes, no new one starts. */
  readonly signal: AbortSignal;
  readonly tick: () => Promise<TickReport>;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly logger: Logger;
}

/**
 * Runs ticks until the signal aborts, waiting `intervalMs` between them and backing off exponentially
 * while ticks fail, so an outage of GitHub is not hammered.
 *
 * @remarks
 * A tick is never cut short: the signal is checked before starting one and the wait ends early when it
 * aborts. A tick's own per-item errors are part of its report; only a tick that throws counts as a failure.
 */
export async function runDaemon(options: DaemonOptions): Promise<number> {
  let ticks = 0;
  let failures = 0;

  while (!isStopping(options.signal)) {
    try {
      const report = await options.tick();

      ticks += 1;
      failures = 0;

      options.logger.info(
        'daemon.tick',
        summarize(report),
      );
    } catch (error) {
      failures += 1;

      options.logger.warn(
        'daemon.tick-failed',
        {
          message: error instanceof Error ? error.message : String(error),
          failures,
          retryInMs: waitAfter(
            failures,
            options,
          ),
        },
      );
    }

    if (!isStopping(options.signal)) {
      await options.sleep(
        waitAfter(
          failures,
          options,
        ),
        options.signal,
      );
    }
  }

  options.logger.info(
    'daemon.stopped',
    { ticks },
  );

  return ticks;
}

/** Read through a call, because a tick can abort the signal while it runs. */
function isStopping(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** The wait before the next tick: the interval, doubled per consecutive failure, capped. */
export function waitAfter(
  failures: number,
  options: Pick<DaemonOptions, 'intervalMs' | 'maxBackoffMs'>,
): number {
  return failures === 0 ? options.intervalMs : Math.min(
    options.intervalMs * 2 ** failures,
    options.maxBackoffMs,
  );
}

/** How many entries of each kind a tick produced, for one log line per tick. */
export function summarize(report: TickReport): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const entry of report.entries) {
    const kind = entry.result?.kind === 'error' ? 'error' : entry.action.kind;

    counts[kind] = (counts[kind] ?? 0) + 1;
  }

  for (const entry of report.board) {
    const kind = entry.result?.kind === 'error' ? 'error' : `board.${entry.action.kind}`;

    counts[kind] = (counts[kind] ?? 0) + 1;
  }

  return counts;
}

/** Waits `ms`, ending early and quietly when the signal aborts. */
export async function sleep(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  try {
    await delay(
      ms,
      undefined,
      { signal },
    );
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }
}

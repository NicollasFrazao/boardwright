import type {
  DoctorReport,
  ExecutionResult,
  PlannedAction,
  TickReport,
} from '@boardwright/core';

const STATUS_LABEL = {
  ok: 'ok  ',
  warn: 'warn',
  fail: 'FAIL',
} as const;

/** The `doctor` report as lines for a terminal, with a one-line summary. */
export function formatDoctor(report: DoctorReport): string {
  const counts = {
    ok: 0,
    warn: 0,
    fail: 0,
  };

  const lines = report.checks.map((check) => {
    counts[check.status] += 1;

    return `${STATUS_LABEL[check.status]}  ${check.subject}: ${check.detail}`;
  });

  lines.push(
    '',
    `${counts.ok} ok, ${counts.warn} warnings, ${counts.fail} failures.`,
  );

  return lines.join('\n');
}

/** A tick's report as lines for a terminal: the plan, and what came of each action unless it was a dry run. */
export function formatTick(
  report: TickReport,
  isDryRun: boolean,
): string {
  const footer = isDryRun ? 'Dry run: nothing was written.' : 'Done.';

  if (report.entries.length === 0) {
    return `Nothing to do: no item is in a Status a stage starts from.\n\n${footer}`;
  }

  const lines = report.entries.map((entry) => {
    const plan = `${entry.stage}  ${entry.issue.repository}#${entry.issue.number}  ${describeAction(entry.action)}`;

    return entry.result === undefined ? plan : `${plan} → ${describeResult(entry.result)}`;
  });

  lines.push(
    '',
    footer,
  );

  return lines.join('\n');
}

function describeAction(action: PlannedAction): string {
  switch (action.kind) {
    case 'skip':
      return `skip (${action.reason})`;
    case 'deferred':
      return `deferred: attempt ${action.attempt} waits for a free slot`;
    case 'repair-status':
      return `move the card to "${action.status}"`;
    case 'give-up':
      return `give up after ${action.attempts} attempts`;
    case 'run':
      return `run attempt ${action.attempt}`;
  }
}

function describeResult(result: ExecutionResult): string {
  switch (result.kind) {
    case 'applied':
      return 'done';
    case 'lost-claim':
      return 'another runner claimed it first';
    case 'completed':
      return `${result.outcome.event}: ${result.outcome.detail.split('\n')[0] ?? ''}`;
    case 'error':
      return `error: ${result.message}`;
  }
}

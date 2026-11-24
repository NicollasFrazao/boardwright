import type {
  DoctorReport,
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

/** A dry run's plan as lines for a terminal. */
export function formatPlan(report: TickReport): string {
  if (report.entries.length === 0) {
    return 'Nothing to do: no item is in a Status a stage starts from.\n\nDry run: nothing was written.';
  }

  const lines = report.entries.map((entry) => `${entry.stage}  ${entry.issue.repository}#${entry.issue.number}  ${describeAction(entry.action)}`);

  lines.push(
    '',
    'Dry run: nothing was written.',
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

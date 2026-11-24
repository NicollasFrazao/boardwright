import type { TickReport } from '@boardwright/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import { formatTick } from '../src/format.ts';

const issue = {
  repository: 'acme/app',
  number: 7,
};

describe('formatTick', () => {
  it('describes every kind of action in one line each', () => {
    const report: TickReport = {
      entries: [
        {
          kind: 'run',
          attempt: 2,
        },
        {
          kind: 'deferred',
          attempt: 1,
        },
        {
          kind: 'repair-status',
          status: 'In review',
        },
        {
          kind: 'give-up',
          attempts: 3,
        },
        {
          kind: 'skip',
          reason: 'in-flight',
        },
      ].map((action) => ({
        stage: 'implement',
        itemId: 'item',
        issue,
        action: action as TickReport['entries'][number]['action'],
        result: undefined,
      })),
    };

    expect(formatTick(
      report,
      true,
    ).split('\n')).toEqual([
      'implement  acme/app#7  run attempt 2',
      'implement  acme/app#7  deferred: attempt 1 waits for a free slot',
      'implement  acme/app#7  move the card to "In review"',
      'implement  acme/app#7  give up after 3 attempts',
      'implement  acme/app#7  skip (in-flight)',
      '',
      'Dry run: nothing was written.',
    ]);
  });

  it('adds what came of each action after a real run', () => {
    const entry = (result: TickReport['entries'][number]['result']): TickReport['entries'][number] => ({
      stage: 'implement',
      itemId: 'item',
      issue,
      action: {
        kind: 'run',
        attempt: 1,
      },
      result,
    });

    const report: TickReport = {
      entries: [
        entry({
          kind: 'completed',
          outcome: {
            event: 'succeeded',
            detail: 'Opened https://github.com/acme/app/pull/9.',
            pullRequest: undefined,
          },
        }),
        entry({ kind: 'lost-claim' }),
        entry({ kind: 'applied' }),
        entry({
          kind: 'error',
          message: 'GitHub is down',
        }),
      ],
    };

    expect(formatTick(
      report,
      false,
    ).split('\n')).toEqual([
      'implement  acme/app#7  run attempt 1 → succeeded: Opened https://github.com/acme/app/pull/9.',
      'implement  acme/app#7  run attempt 1 → another runner claimed it first',
      'implement  acme/app#7  run attempt 1 → done',
      'implement  acme/app#7  run attempt 1 → error: GitHub is down',
      '',
      'Done.',
    ]);
  });
});

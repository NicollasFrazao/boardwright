import type { TickReport } from '@boardwright/core';
import {
  describe,
  expect,
  it,
} from 'vitest';
import { formatPlan } from '../src/format.ts';

const issue = {
  repository: 'acme/app',
  number: 7,
};

describe('formatPlan', () => {
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

    expect(formatPlan(report).split('\n')).toEqual([
      'implement  acme/app#7  run attempt 2',
      'implement  acme/app#7  deferred: attempt 1 waits for a free slot',
      'implement  acme/app#7  move the card to "In review"',
      'implement  acme/app#7  give up after 3 attempts',
      'implement  acme/app#7  skip (in-flight)',
      '',
      'Dry run: nothing was written.',
    ]);
  });
});

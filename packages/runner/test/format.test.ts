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
      board: [],
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
      board: [],
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

  it('puts board hygiene first, with its result', () => {
    const report: TickReport = {
      board: [
        {
          action: {
            kind: 'add-issue',
            issue,
          },
          result: { kind: 'applied' },
        },
        {
          action: {
            kind: 'set-field',
            issue,
            field: 'Track',
            value: 'Showcase',
          },
          result: {
            kind: 'error',
            message: 'no such option',
          },
        },
        {
          action: {
            kind: 'start-parent',
            issue,
            child: {
              repository: 'acme/app',
              number: 8,
            },
            status: 'In Progress',
          },
          result: undefined,
        },
      ],
      entries: [],
    };

    expect(formatTick(
      report,
      false,
    ).split('\n')).toEqual([
      'board  acme/app#7  add to the board → done',
      'board  acme/app#7  set Track to "Showcase" → error: no such option',
      'board  acme/app#7  move to "In Progress": sub-issue acme/app#8 started',
      '',
      'Done.',
    ]);
  });
});

describe('formatTick: items outside the allowlist', () => {
  const outside = (
    stage: string,
    number: number,
  ): TickReport['entries'][number] => ({
    stage,
    itemId: `item-${number}`,
    issue: {
      repository: 'acme/other',
      number,
    },
    action: {
      kind: 'skip',
      reason: 'repository-not-allowed',
    },
    result: undefined,
  });

  it('sums them up in one line, each item once whatever the stages, after what was planned', () => {
    const report: TickReport = {
      board: [],
      entries: [
        outside(
          'review',
          1,
        ),
        {
          stage: 'refine',
          itemId: 'item',
          issue,
          action: {
            kind: 'run',
            attempt: 1,
          },
          result: undefined,
        },
        outside(
          'address-feedback',
          1,
        ),
        outside(
          'refine',
          2,
        ),
      ],
    };

    expect(formatTick(
      report,
      true,
    ).split('\n')).toEqual([
      'refine  acme/app#7  run attempt 1',
      'Left alone: 2 items of repositories outside the allowlist.',
      '',
      'Dry run: nothing was written.',
    ]);
  });

  it('still says there is nothing to do when they are all there is', () => {
    expect(formatTick(
      {
        board: [],
        entries: [
          outside(
            'refine',
            3,
          ),
        ],
      },
      false,
    ).split('\n')).toEqual([
      'Nothing to do: no item is in a Status a stage starts from.',
      'Left alone: 1 item of repositories outside the allowlist.',
      '',
      'Done.',
    ]);
  });
});

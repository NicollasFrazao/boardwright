import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  DEFAULT_MERGE_DENIED_PATHS,
  evaluateMergePolicy,
  failureKey,
  formatMergeMarker,
  parseMergeMarker,
  type MergeFacts,
  type MergePolicy,
} from '../src/index.ts';

const POLICY: MergePolicy = {
  requireAgentApproval: true,
  maxChangedLines: 400,
  deniedPaths: DEFAULT_MERGE_DENIED_PATHS,
  optInLabel: 'boardwright:merge',
  optOutLabel: 'boardwright:hold',
};

const PASSING: MergeFacts = {
  pullRequestId: 'PR_1',
  headSha: 'abc1234',
  isDraft: false,
  labels: [
    'boardwright:agent',
    'boardwright:merge',
  ],
  checks: 'passing',
  mergeability: 'mergeable',
  unresolvedThreads: 0,
  agentVerdict: 'approve',
  changedLines: 120,
  changedPaths: ['src/feature.ts'],
  isAutoMergeEnabled: false,
};

describe('evaluateMergePolicy', () => {
  it('passes when every condition holds', () => {
    expect(evaluateMergePolicy(
      PASSING,
      POLICY,
    )).toEqual({
      decision: 'pass',
      failures: [],
    });
  });

  it.each([
    [
      'a draft',
      { isDraft: true },
      'draft',
    ],
    [
      'conflicts',
      { mergeability: 'conflicting' },
      'conflicts',
    ],
    [
      'failing checks',
      { checks: 'failing' },
      'checks-failing',
    ],
    [
      'an unresolved thread',
      { unresolvedThreads: 1 },
      'unresolved-threads',
    ],
    [
      'a review asking for changes',
      { agentVerdict: 'changes' },
      'review-changes',
    ],
    [
      'too many changed lines',
      { changedLines: 401 },
      'too-large',
    ],
    [
      'a workflow change',
      {
        changedPaths: [
          'src/a.ts',
          '.github/workflows/ci.yml',
        ],
      },
      'denied-paths',
    ],
    [
      'a migration',
      { changedPaths: ['db/migrations/0002_add.sql'] },
      'denied-paths',
    ],
    [
      'a lockfile',
      { changedPaths: ['package-lock.json'] },
      'denied-paths',
    ],
  ] as const)('blocks %s, and only for that', (
    _case,
    change,
    code,
  ) => {
    const evaluation = evaluateMergePolicy(
      {
        ...PASSING,
        ...change,
      },
      POLICY,
    );

    expect(evaluation.decision).toBe('blocked');
    expect(evaluation.failures.map((failure) => failure.code)).toEqual([code]);
  });

  it.each([
    [
      'checks still running',
      { checks: 'pending' },
      'checks-pending',
    ],
    [
      'no checks reported yet',
      { checks: 'none' },
      'checks-pending',
    ],
    [
      'mergeability not computed',
      { mergeability: 'unknown' },
      'mergeability-unknown',
    ],
    [
      'no review of the head yet',
      { agentVerdict: undefined },
      'review-missing',
    ],
  ] as const)('waits quietly with %s', (
    _case,
    change,
    code,
  ) => {
    const evaluation = evaluateMergePolicy(
      {
        ...PASSING,
        ...change,
      },
      POLICY,
    );

    expect(evaluation.decision).toBe('waiting');
    expect(evaluation.failures.map((failure) => failure.code)).toEqual([code]);
  });

  it('reports a block before waiting: a failing condition is never hidden by a pending one', () => {
    const evaluation = evaluateMergePolicy(
      {
        ...PASSING,
        checks: 'pending',
        changedLines: 900,
      },
      POLICY,
    );

    expect(evaluation.decision).toBe('blocked');
    expect(evaluation.failures.map((failure) => failure.code)).toEqual(['too-large']);
  });

  it('leaves alone a pull request without the opt-in label, and merges without one when none is required', () => {
    const unlabelled = {
      ...PASSING,
      labels: ['boardwright:agent'],
    };

    expect(evaluateMergePolicy(
      unlabelled,
      POLICY,
    ).decision).toBe('not-opted-in');

    expect(evaluateMergePolicy(
      unlabelled,
      {
        ...POLICY,
        optInLabel: undefined,
      },
    ).decision).toBe('pass');
  });

  it('lets the opt-out label win over everything, the opt-in label included', () => {
    expect(evaluateMergePolicy(
      {
        ...PASSING,
        labels: [
          'boardwright:merge',
          'boardwright:hold',
        ],
      },
      POLICY,
    )).toEqual({
      decision: 'blocked',
      failures: [
        {
          code: 'opted-out',
          detail: 'The pull request is labelled `boardwright:hold`: a person merges it.',
        },
      ],
    });
  });

  it('ignores the review when approval is not required', () => {
    expect(evaluateMergePolicy(
      {
        ...PASSING,
        agentVerdict: undefined,
      },
      {
        ...POLICY,
        requireAgentApproval: false,
      },
    ).decision).toBe('pass');
  });
});

describe('merge markers and failure keys', () => {
  it('keys failures by their codes, in a stable order', () => {
    expect(failureKey([
      {
        code: 'too-large',
        detail: '',
      },
      {
        code: 'denied-paths',
        detail: '',
      },
    ])).toBe('denied-paths+too-large');
  });

  it('reads back what it writes and ignores unknown versions', () => {
    const marker = {
      headSha: 'abc1234',
      decision: 'blocked',
      key: 'denied-paths+too-large',
    } as const;

    expect(parseMergeMarker(`${formatMergeMarker(marker)}\ntext`)).toEqual(marker);
    expect(parseMergeMarker('<!-- boardwright:merge v=2 head=abc1234 decision=merged key=pass -->')).toBeUndefined();
    expect(parseMergeMarker('<!-- boardwright:merge v=1 head=abc1234 decision=forced key=pass -->')).toBeUndefined();
  });
});

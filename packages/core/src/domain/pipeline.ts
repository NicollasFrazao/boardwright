/** A phase of the dotcontext PREVC workflow: Plan, Review, Execute, Verify, Complete. */
export type PrevcPhase = 'P' | 'R' | 'E' | 'V' | 'C';

/** Every PREVC phase, in workflow order. */
export const PREVC_PHASES: readonly PrevcPhase[] = [
  'P',
  'R',
  'E',
  'V',
  'C',
];

/** What happened to a run, as recorded in the markers on its issue. */
export type RunEvent = 'started' | 'succeeded' | 'failed' | 'blocked' | 'denied' | 'gave-up';

/** The events a run can end with. */
export type RunOutcomeEvent = Exclude<RunEvent, 'started' | 'gave-up'>;

/** A reference to an issue: `owner/name` and its number. */
export interface IssueRef {
  readonly repository: string;
  readonly number: number;
}

/** A comment on an issue, as the repository host returns it. */
export interface IssueComment {
  readonly id: string;
  readonly body: string;
  readonly createdAt: Date;
}

/** Formats an issue reference as `owner/name#number`. */
export function formatIssueRef(ref: IssueRef): string {
  return `${ref.repository}#${ref.number}`;
}

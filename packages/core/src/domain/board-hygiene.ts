import {
  formatIssueRef,
  type IssueRef,
} from './pipeline.ts';

/** What the hygiene rules read of a board item. */
export interface HygieneItem {
  readonly itemId: string;
  readonly status: string | null;
  readonly issue: IssueRef;

  /** The item's single-select values, by field name. */
  readonly fields: Readonly<Record<string, string>>;

  /** The issue's parent, when it is a sub-issue. */
  readonly parent: IssueRef | undefined;
}

/** When a parent issue counts as started, and where it goes then. */
export interface ParentRule {
  /** Statuses of a parent that has not started; an empty Status always counts as not started. */
  readonly notStarted: readonly string[];

  /** Statuses of a sub-issue that mean work on the parent has started. */
  readonly started: readonly string[];

  /** Where a parent that has not started goes once a sub-issue has. */
  readonly status: string;
}

/** A parent to move, and the sub-issue that moves it. */
export interface ParentToStart {
  readonly parent: HygieneItem;
  readonly child: IssueRef;
}

/**
 * The value a field takes from the repository's other items: the most common one, the first by name on a
 * tie, so every runner infers the same value.
 *
 * @returns `undefined` when no other item of the repository has a value.
 */
export function inferFieldValue(
  items: readonly HygieneItem[],
  item: HygieneItem,
  field: string,
): string | undefined {
  const counts = new Map<string, number>();

  for (const other of items) {
    const value = other.fields[field];

    if (
      other.itemId !== item.itemId
      && other.issue.repository === item.issue.repository
      && value !== undefined
    ) {
      counts.set(
        value,
        (counts.get(value) ?? 0) + 1,
      );
    }
  }

  const [best] = [...counts].sort((
    left,
    right,
  ) => right[1] - left[1] || left[0].localeCompare(right[0]));

  return best?.[0];
}

/**
 * The parents on the board that have not started although one of their sub-issues has, each once, with
 * the first such sub-issue in board order.
 *
 * @remarks
 * Safe to repeat: a parent already moved is no longer "not started", so a second pass finds nothing.
 */
export function parentsToStart(
  items: readonly HygieneItem[],
  rule: ParentRule,
): ParentToStart[] {
  const byIssue = new Map(items.map((item) => [
    formatIssueRef(item.issue),
    item,
  ]));

  const found = new Map<string, ParentToStart>();

  for (const child of items) {
    const parent = child.parent === undefined ? undefined : byIssue.get(formatIssueRef(child.parent));

    if (
      parent !== undefined
      && child.status !== null
      && rule.started.includes(child.status)
      && hasNotStarted(
        parent,
        rule,
      )
      && !found.has(parent.itemId)
    ) {
      found.set(
        parent.itemId,
        {
          parent,
          child: child.issue,
        },
      );
    }
  }

  return [...found.values()];
}

/** An empty Status always counts as not started. */
function hasNotStarted(
  item: HygieneItem,
  rule: ParentRule,
): boolean {
  return item.status === null || rule.notStarted.includes(item.status);
}

/** The issues of a recent listing that are not on the board yet. */
export function issuesNotOnBoard(
  items: readonly Pick<HygieneItem, 'issue'>[],
  recent: readonly IssueRef[],
): IssueRef[] {
  const onBoard = new Set(items.map((item) => formatIssueRef(item.issue)));

  return recent.filter((ref) => !onBoard.has(formatIssueRef(ref)));
}

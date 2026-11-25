import { isAllowedRepository } from '../domain/guard-rails.ts';
import {
  inferFieldValue,
  issuesNotOnBoard,
  parentsToStart,
  type HygieneItem,
} from '../domain/board-hygiene.ts';
import {
  formatIssueRef,
  type IssueRef,
} from '../domain/pipeline.ts';
import type { PipelineConfig } from './config.ts';
import type {
  BoardItem,
  BoardPort,
  Clock,
  Logger,
  RepoHostPort,
} from './ports.ts';

const MS_PER_DAY = 86_400_000;

/** What board hygiene touches. */
export interface BoardHygieneDependencies {
  readonly config: PipelineConfig;
  readonly board: BoardPort;
  readonly repoHost: RepoHostPort;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** One change board hygiene decided. */
export type BoardAction =
  | {
    readonly kind: 'add-issue';
    readonly issue: IssueRef;
  }
  | {
    readonly kind: 'set-field';
    readonly issue: IssueRef;
    readonly field: string;
    readonly value: string;
  }
  | {
    readonly kind: 'start-parent';
    readonly issue: IssueRef;
    readonly child: IssueRef;
    readonly status: string;
  };

/** A decided change and what carrying it out produced: `undefined` in a dry run. */
export interface BoardEntry {
  readonly action: BoardAction;
  readonly result:
    | { readonly kind: 'applied' }
    | {
      readonly kind: 'error';
      readonly message: string;
    }
    | undefined;
}

/** What a pass of board hygiene did, and whether the board changed. */
export interface BoardHygieneReport {
  readonly entries: readonly BoardEntry[];
  readonly hasChanges: boolean;
}

interface Pass {
  readonly dependencies: BoardHygieneDependencies;
  readonly dryRun: boolean;
  readonly entries: BoardEntry[];
  readonly items: HygieneItem[];
}

/**
 * Tidies the board before the stages run: adds new issues, fills inferred fields, moves parents whose
 * sub-issues started. Each part runs only when the config turns it on, and only changes items of the
 * allowlisted repositories; the other items of the board are read (a parent, a value to count), never
 * changed.
 *
 * @remarks
 * Every change is safe to repeat: an issue already on the board is not added again (the board also
 * returns the existing item), a field with a value is left alone, and a parent that moved no longer
 * counts as not started. A failure is reported on its entry and does not stop the others.
 */
export async function tidyBoard(
  dependencies: BoardHygieneDependencies,
  items: readonly BoardItem[],
  options: { readonly dryRun: boolean },
): Promise<BoardHygieneReport> {
  const pass: Pass = {
    dependencies,
    dryRun: options.dryRun,
    entries: [],
    items: items.map(toHygieneItem),
  };

  const hygiene = dependencies.config.board;

  if (hygiene.addNewIssues) {
    await addNewIssues(pass);
  }

  for (const field of await knownFields(
    dependencies,
    hygiene.inferFields,
  )) {
    await inferField(
      pass,
      field,
    );
  }

  if (hygiene.followSubIssues) {
    await startParents(pass);
  }

  return {
    entries: pass.entries,
    hasChanges: pass.entries.some((entry) => entry.result?.kind === 'applied'),
  };
}

function toHygieneItem(item: BoardItem): HygieneItem {
  return {
    itemId: item.itemId,
    status: item.status,
    issue: item.issue,
    fields: item.fields ?? {},
    parent: item.parent,
  };
}

async function addNewIssues(pass: Pass): Promise<void> {
  const {
    config,
    repoHost,
    clock,
  } = pass.dependencies;

  const createdAfter = new Date(clock.now().getTime() - config.board.newIssueWindowDays * MS_PER_DAY);

  for (const repository of config.repositories) {
    const recent = await attempt(
      pass,
      () => repoHost.listRecentIssues(
        repository,
        createdAfter,
      ),
    );

    for (const issue of issuesNotOnBoard(
      pass.items,
      recent.isOk ? recent.value : [],
    )) {
      let itemId = `planned:${formatIssueRef(issue)}`;

      const isOnBoard = await record(
        pass,
        {
          kind: 'add-issue',
          issue,
        },
        async () => {
          itemId = await pass.dependencies.board.addIssue(issue);
        },
      );

      // A new item has no Status and no field yet; the inference below fills it in the same tick.
      if (
        isOnBoard
        || pass.dryRun
      ) {
        pass.items.push({
          itemId,
          status: null,
          issue,
          fields: {},
          parent: undefined,
        });
      }
    }
  }
}

/** The fields to infer that exist on the board; a missing one is logged, and `doctor` reports it. */
async function knownFields(
  dependencies: BoardHygieneDependencies,
  fields: readonly string[],
): Promise<readonly string[]> {
  if (fields.length === 0) {
    return fields;
  }

  const available = (await dependencies.board.describe()).singleSelectFields ?? {};

  return fields.filter((field) => {
    const isKnown = field in available;

    if (!isKnown) {
      dependencies.logger.warn(
        'board.field-missing',
        { field },
      );
    }

    return isKnown;
  });
}

async function inferField(
  pass: Pass,
  field: string,
): Promise<void> {
  for (const [
    index,
    item,
  ] of pass.items.entries()) {
    const value = item.fields[field] === undefined && isAllowed(
      pass,
      item.issue,
    ) ? inferFieldValue(
          pass.items,
          item,
          field,
        ) : undefined;

    if (value === undefined) {
      continue;
    }

    const isApplied = await record(
      pass,
      {
        kind: 'set-field',
        issue: item.issue,
        field,
        value,
      },
      () => pass.dependencies.board.setField(
        item.itemId,
        field,
        value,
      ),
    );

    // Only a value that is on the board counts towards the next item's inference.
    if (
      isApplied
      || pass.dryRun
    ) {
      pass.items[index] = {
        ...item,
        fields: {
          ...item.fields,
          [field]: value,
        },
      };
    }
  }
}

async function startParents(pass: Pass): Promise<void> {
  const rule = pass.dependencies.config.board.parents;

  for (const {
    parent,
    child,
  } of parentsToStart(
      pass.items,
      rule,
    ).filter((candidate) => isAllowed(
      pass,
      candidate.parent.issue,
    ))) {
    await record(
      pass,
      {
        kind: 'start-parent',
        issue: parent.issue,
        child,
        status: rule.status,
      },
      () => pass.dependencies.board.setStatus(
        parent.itemId,
        rule.status,
      ),
    );
  }
}

/** Hygiene changes only the items of the allowlisted repositories, like every stage. */
function isAllowed(
  pass: Pass,
  issue: IssueRef,
): boolean {
  return isAllowedRepository(
    issue.repository,
    pass.dependencies.config.repositories,
  );
}

/** Carries out an action unless it is a dry run, and records it; resolves whether it was applied. */
async function record(
  pass: Pass,
  action: BoardAction,
  apply: () => Promise<void>,
): Promise<boolean> {
  if (pass.dryRun) {
    pass.entries.push({
      action,
      result: undefined,
    });

    return false;
  }

  const outcome = await attempt(
    pass,
    apply,
  );

  pass.entries.push({
    action,
    result: outcome.isOk ? { kind: 'applied' } : {
      kind: 'error',
      message: outcome.message,
    },
  });

  pass.dependencies.logger.info(
    'board.action',
    {
      action,
      issue: formatIssueRef(action.issue),
      result: outcome.isOk ? 'applied' : 'error',
    },
  );

  return outcome.isOk;
}

type Outcome<T> =
  | {
    readonly isOk: true;
    readonly value: T;
  }
  | {
    readonly isOk: false;
    readonly message: string;
  };

/** Runs a read or a write; a failure is logged and returned instead of thrown. */
async function attempt<T>(
  pass: Pass,
  run: () => Promise<T>,
): Promise<Outcome<T>> {
  try {
    return {
      isOk: true,
      value: await run(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    pass.dependencies.logger.warn(
      'board.error',
      { message },
    );

    return {
      isOk: false,
      message,
    };
  }
}

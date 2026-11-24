import type {
  AgentProvider,
  AgentRequest,
  AgentResult,
  BoardItem,
  BoardPort,
  Clock,
  ContextProvider,
  ContextSelector,
  Issue,
  IssueComment,
  IssueRef,
  LabelActor,
  Logger,
  PipelineConfig,
  PullRequest,
  PullRequestDraft,
  RepoHostPort,
  RunIdSource,
  StageContext,
  TickDependencies,
  Workspace,
  WorkspacePort,
  WorkspaceRequest,
} from '../src/index.ts';
import { parsePipelineConfig } from '../src/index.ts';

/** `owner/name#number`, the key the fakes store issues under. */
export function keyOf(ref: IssueRef): string {
  return `${ref.repository}#${ref.number}`;
}

/** A clock that only moves when a test moves it. */
class FakeClock implements Clock {
  private current: Date;

  constructor(iso = '2026-11-24T12:00:00Z') {
    this.current = new Date(iso);
  }

  /** The frozen current time. */
  now(): Date {
    return new Date(this.current);
  }

  /** Moves the clock forward. */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** An in-memory board. */
class FakeBoard implements BoardPort {
  /** Every Status change, in order. */
  readonly moves: {
    itemId: string;
    status: string;
  }[] = [];

  constructor(readonly items: BoardItem[]) {}

  /** A copy of the items. */
  listItems(): Promise<BoardItem[]> {
    return Promise.resolve(this.items.map((item) => ({ ...item })));
  }

  /** Moves an item and records the move. */
  setStatus(
    itemId: string,
    status: string,
  ): Promise<void> {
    const index = this.items.findIndex((item) => item.itemId === itemId);
    const item = this.items[index];

    if (item === undefined) {
      return Promise.reject(new Error(`No item ${itemId}`));
    }

    this.items[index] = {
      ...item,
      status,
    };

    this.moves.push({
      itemId,
      status,
    });

    return Promise.resolve();
  }

  /** The Status of an item now. */
  statusOf(itemId: string): string | null | undefined {
    return this.items.find((item) => item.itemId === itemId)?.status;
  }
}

/** An in-memory repository host. */
class FakeRepoHost implements RepoHostPort {
  readonly issues = new Map<string, Issue>();

  readonly comments = new Map<string, IssueComment[]>();

  readonly labelActors = new Map<string, LabelActor>();

  readonly openPullRequests = new Map<string, PullRequest>();

  readonly drafts: PullRequestDraft[] = [];

  /** Called after each comment is stored; a test uses it to play a competing runner. */
  afterComment: ((ref: IssueRef, body: string) => void) | undefined;

  private sequence = 0;

  constructor(private readonly clock: FakeClock) {}

  /** The stored issue; rejects when there is none. */
  getIssue(ref: IssueRef): Promise<Issue> {
    const issue = this.issues.get(keyOf(ref));

    return issue === undefined ? Promise.reject(new Error(`No issue ${keyOf(ref)}`)) : Promise.resolve(issue);
  }

  /** The stored labeller of the issue. */
  findLabelActor(ref: IssueRef): Promise<LabelActor | undefined> {
    return Promise.resolve(this.labelActors.get(keyOf(ref)));
  }

  /** A copy of the issue's comments. */
  listComments(ref: IssueRef): Promise<IssueComment[]> {
    return Promise.resolve([...(this.comments.get(keyOf(ref)) ?? [])]);
  }

  /** Stores the comment, then calls `afterComment`. */
  addComment(
    ref: IssueRef,
    body: string,
  ): Promise<void> {
    this.store(
      ref,
      body,
    );

    this.afterComment?.(
      ref,
      body,
    );

    return Promise.resolve();
  }

  /** Stores a comment as if someone else wrote it, at the clock's current time. */
  store(
    ref: IssueRef,
    body: string,
    createdAt = this.clock.now(),
  ): void {
    this.sequence += 1;

    const list = this.comments.get(keyOf(ref)) ?? [];

    list.push({
      id: `c${String(this.sequence).padStart(
        4,
        '0',
      )}`,
      body,
      createdAt,
    });

    this.comments.set(
      keyOf(ref),
      list,
    );
  }

  /** The bodies of an issue's comments. */
  bodies(ref: IssueRef): string[] {
    return (this.comments.get(keyOf(ref)) ?? []).map((comment) => comment.body);
  }

  /** Always `master`. */
  getDefaultBranch(): Promise<string> {
    return Promise.resolve('master');
  }

  /** The open pull request stored for the branch. */
  findOpenPullRequest(
    repository: string,
    head: string,
  ): Promise<PullRequest | undefined> {
    return Promise.resolve(this.openPullRequests.get(`${repository}:${head}`));
  }

  /** Records the draft and stores a new open pull request. */
  openPullRequest(draft: PullRequestDraft): Promise<PullRequest> {
    const pullRequest = {
      number: 100 + this.drafts.length,
      url: `https://github.com/${draft.repository}/pull/${100 + this.drafts.length}`,
    };

    this.drafts.push(draft);

    this.openPullRequests.set(
      `${draft.repository}:${draft.head}`,
      pullRequest,
    );

    return Promise.resolve(pullRequest);
  }
}

/** Workspaces that record what was done with them. */
class FakeWorkspaces implements WorkspacePort {
  changed: string[] = ['src/feature.ts'];

  readonly prepared: Workspace[] = [];

  readonly pushed: Workspace[] = [];

  readonly disposed: Workspace[] = [];

  /** Records a worktree under a fixed path. */
  prepare(request: WorkspaceRequest): Promise<Workspace> {
    const workspace = {
      ...request,
      path: `/work/worktrees/${request.branch}`,
    };

    this.prepared.push(workspace);

    return Promise.resolve(workspace);
  }

  /** The paths the test set in `changed`. */
  changedPaths(): Promise<string[]> {
    return Promise.resolve([...this.changed]);
  }

  /** Records the push. */
  push(workspace: Workspace): Promise<void> {
    this.pushed.push(workspace);

    return Promise.resolve();
  }

  /** Records the disposal. */
  dispose(workspace: Workspace): Promise<void> {
    this.disposed.push(workspace);

    return Promise.resolve();
  }
}

/** An agent that returns a fixed result, or throws. */
class FakeAgent implements AgentProvider {
  result: AgentResult = {
    status: 'completed',
    summary: 'Done.',
    pullRequest: {
      title: 'feat(app): add the feature',
      body: 'Adds the feature.',
    },
  };

  error: Error | undefined;

  readonly requests: AgentRequest[] = [];

  /** Records the request; returns `result` or rejects with `error`. */
  run(request: AgentRequest): Promise<AgentResult> {
    this.requests.push(request);

    return this.error === undefined ? Promise.resolve(this.result) : Promise.reject(this.error);
  }
}

/** A context provider that returns a fixed context. */
export class FakeContext implements ContextProvider {
  context: StageContext = {
    source: 'dotcontext',
    playbook: {
      agentType: 'feature-developer',
      path: '.context/agents/feature-developer.md',
    },
    skills: [
      {
        slug: 'commit-message',
        description: 'Write Conventional Commits.',
        path: '.context/skills/commit-message/SKILL.md',
      },
    ],
    instructionFiles: ['.context/docs/README.md'],
    warnings: [],
  };

  readonly selectors: ContextSelector[] = [];

  /** Records the selector; returns `context`. */
  load(
    _root: string,
    selector: ContextSelector,
  ): Promise<StageContext> {
    this.selectors.push(selector);

    return Promise.resolve(this.context);
  }
}

/** Run ids `run-1`, `run-2`, … */
class SequentialRunIds implements RunIdSource {
  private count = 0;

  /** The next sequential id. */
  next(): string {
    this.count += 1;

    return `run-${this.count}`;
  }
}

/** A logger that keeps what it was given. */
class MemoryLogger implements Logger {
  readonly entries: {
    level: 'info' | 'warn';
    event: string;
    fields: unknown;
  }[] = [];

  /** Keeps an info entry. */
  info(
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void {
    this.entries.push({
      level: 'info',
      event,
      fields,
    });
  }

  /** Keeps a warning entry. */
  warn(
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void {
    this.entries.push({
      level: 'warn',
      event,
      fields,
    });
  }
}

/** The issue every scenario starts from: open, labelled `agent` by a maintainer. */
export const ISSUE: IssueRef = {
  repository: 'acme/app',
  number: 7,
};

/**
 * The first stage of a config.
 *
 * @throws {@link Error} when the config has no stage, which fails the test.
 */
export function firstStage(config: PipelineConfig): PipelineConfig['stages'][number] {
  const [stage] = config.stages;

  if (stage === undefined) {
    throw new Error('The config has no stage');
  }

  return stage;
}

/** A minimal valid config with the implement stage and every default. */
export function baseConfig(overrides: Record<string, unknown> = {}): PipelineConfig {
  return parsePipelineConfig({
    project: {
      owner: 'acme',
      number: 3,
    },
    repositories: ['acme/app'],
    stages: [{ id: 'implement' }],
    ...overrides,
  });
}

/** Every fake, wired as tick dependencies, around one issue in Ready. */
export interface Scenario {
  readonly dependencies: TickDependencies;
  readonly board: FakeBoard;
  readonly repoHost: FakeRepoHost;
  readonly workspaces: FakeWorkspaces;
  readonly agent: FakeAgent;
  readonly context: FakeContext;
  readonly clock: FakeClock;
  readonly logger: MemoryLogger;
}

/** A scenario with one triggered issue in Ready; the config can be overridden. */
export function scenario(config: PipelineConfig = baseConfig()): Scenario {
  const clock = new FakeClock();

  const board = new FakeBoard([
    {
      itemId: 'item-7',
      status: 'Ready',
      issue: ISSUE,
    },
  ]);

  const repoHost = new FakeRepoHost(clock);
  const workspaces = new FakeWorkspaces();
  const agent = new FakeAgent();
  const context = new FakeContext();
  const logger = new MemoryLogger();

  repoHost.issues.set(
    keyOf(ISSUE),
    {
      ref: ISSUE,
      title: 'Add the feature',
      body: 'The app needs the feature.',
      labels: ['agent'],
      isOpen: true,
    },
  );

  repoHost.labelActors.set(
    keyOf(ISSUE),
    {
      login: 'maintainer',
      permission: 'maintain',
    },
  );

  return {
    dependencies: {
      config,
      board,
      repoHost,
      workspaces,
      agent,
      context,
      clock,
      runIds: new SequentialRunIds(),
      logger,
    },
    board,
    repoHost,
    workspaces,
    agent,
    context,
    clock,
    logger,
  };
}

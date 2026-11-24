import type { RepositoryPermission } from '../domain/guard-rails.ts';
import type {
  IssueComment,
  IssueRef,
  PrevcPhase,
} from '../domain/pipeline.ts';

/** A card on the board whose content is an issue. */
export interface BoardItem {
  readonly itemId: string;
  readonly status: string | null;
  readonly issue: IssueRef;
}

/** The board: a GitHub Project (v2) and its Status field. */
export interface BoardPort {
  /** The board's title and the options of its Status field. */
  describe(): Promise<BoardDescription>;

  /** Every item of the board whose content is an issue. */
  listItems(): Promise<BoardItem[]>;

  /** Moves an item to a Status option that already exists on the board. */
  setStatus(itemId: string, status: string): Promise<void>;
}

/** What `doctor` checks the config against. */
export interface BoardDescription {
  readonly title: string;

  /** The options of the Status field; `undefined` when the board has no field with the configured name. */
  readonly statusOptions: readonly string[] | undefined;
}

/** An issue as the pipeline needs it. */
export interface Issue {
  readonly ref: IssueRef;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly isOpen: boolean;
}

/** Who added a label, and their permission on the repository. */
export interface LabelActor {
  readonly login: string;
  readonly permission: RepositoryPermission;
}

/** A pull request the pipeline opened or found. */
export interface PullRequest {
  readonly number: number;
  readonly url: string;
}

/** What the pipeline asks the repository host to open. */
export interface PullRequestDraft {
  readonly repository: string;
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

/** Issues, comments and pull requests on the repository host. */
export interface RepoHostPort {
  getIssue(ref: IssueRef): Promise<Issue>;

  /** The person who most recently added `label` to the issue; `undefined` when unknown. */
  findLabelActor(ref: IssueRef, label: string): Promise<LabelActor | undefined>;

  listComments(ref: IssueRef): Promise<IssueComment[]>;

  addComment(ref: IssueRef, body: string): Promise<void>;

  getDefaultBranch(repository: string): Promise<string>;

  findOpenPullRequest(repository: string, head: string): Promise<PullRequest | undefined>;

  openPullRequest(draft: PullRequestDraft): Promise<PullRequest>;

  hasLabel(repository: string, label: string): Promise<boolean>;

  /** A file on the default branch; `undefined` when it does not exist. */
  readFile(repository: string, path: string): Promise<string | undefined>;

  /** The names in a directory on the default branch; empty when it does not exist. */
  listDirectory(repository: string, path: string): Promise<string[]>;
}

/** A checkout prepared for one run. */
export interface Workspace {
  readonly repository: string;
  readonly path: string;
  readonly branch: string;
  readonly base: string;
}

/** What a run needs checked out. */
export interface WorkspaceRequest {
  readonly repository: string;
  readonly branch: string;
  readonly base: string;
}

/** Git checkouts, one per run. */
export interface WorkspacePort {
  /** Checks out `branch`, continuing it when it already exists on the remote, else creating it from `base`. */
  prepare(request: WorkspaceRequest): Promise<Workspace>;

  /** Paths changed on the branch relative to `base`, committed or not, using `/` separators. */
  changedPaths(workspace: Workspace): Promise<string[]>;

  /** Pushes the branch without force. */
  push(workspace: Workspace): Promise<void>;

  dispose(workspace: Workspace): Promise<void>;
}

/** What a stage asks an agent to do. */
export interface AgentRequest {
  readonly stage: string;
  readonly cwd: string;
  readonly prompt: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly deniedPaths: readonly string[];
  readonly model: string | undefined;
}

/** How an agent session ended. */
export interface AgentResult {
  /** `blocked` means the agent stopped to ask a person something, as the prompt tells it to. */
  readonly status: 'completed' | 'blocked' | 'failed';
  readonly summary: string;
  readonly pullRequest: {
    readonly title: string;
    readonly body: string;
  } | undefined;
}

/** An agent runtime (Claude first). */
export interface AgentProvider {
  run(request: AgentRequest): Promise<AgentResult>;
}

/** Which playbook and skills a stage wants. */
export interface ContextSelector {
  readonly phase: PrevcPhase;
  readonly agent: string;
}

/** A playbook file of the target repository, relative to its root. */
export interface PlaybookReference {
  readonly agentType: string;
  readonly path: string;
}

/** A skill file of the target repository, relative to its root. */
export interface SkillReference {
  readonly slug: string;
  readonly description: string;
  readonly path: string;
}

/** The repository's own guidance for a stage. */
export interface StageContext {
  readonly source: 'dotcontext' | 'plain';
  readonly playbook: PlaybookReference | undefined;
  readonly skills: readonly SkillReference[];

  /** Files the agent reads first (a context index, `AGENTS.md`), relative to the root. */
  readonly instructionFiles: readonly string[];

  /** What was asked for and not found, for `doctor` and the logs. */
  readonly warnings: readonly string[];
}

/** Reads a checked-out repository's guidance for agents. */
export interface ContextProvider {
  load(root: string, selector: ContextSelector): Promise<StageContext>;
}

/** The current time. */
export interface Clock {
  now(): Date;
}

/** New run ids. */
export interface RunIdSource {
  next(): string;
}

/** Structured logs; the fields never carry tokens. */
export interface Logger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

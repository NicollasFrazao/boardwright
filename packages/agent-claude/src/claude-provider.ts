import { existsSync } from 'node:fs';
import {
  isAbsolute,
  join,
  relative,
} from 'node:path';
import {
  query as sdkQuery,
  type HookCallback,
  type HookJSONOutput,
  type McpServerConfig,
  type Options,
  type SDKMessage,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  findDeniedPaths,
  type AgentProvider,
  type AgentRequest,
  type AgentResult,
} from '@boardwright/core';
import { z } from 'zod';

/** The tools an implementing agent may use without asking; anything else is denied (`dontAsk`). */
export const STAGE_TOOLS: readonly string[] = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'TodoWrite',
];

/** Read-only dotcontext tools, allowed when the repository has a `.context` base. */
const DOTCONTEXT_TOOLS: readonly string[] = [
  'mcp__dotcontext__context',
  'mcp__dotcontext__explore',
  'mcp__dotcontext__agent',
  'mcp__dotcontext__skill',
];

/**
 * Tools denied even if a repository's settings allow them: the web (a path out for whatever the session
 * read) and dotcontext's `sync`, whose exports write agent surfaces the repository does not control.
 */
export const DENIED_TOOLS: readonly string[] = [
  'WebFetch',
  'WebSearch',
  'mcp__dotcontext__sync',
];

/** The runner's GitHub tokens; the agent's environment never carries them. */
export const TOKEN_VARIABLES: readonly string[] = [
  'BOARDWRIGHT_GITHUB_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
];

const FILE_TOOLS: ReadonlySet<string> = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
]);

/** Pushing and talking to GitHub are the pipeline's job, after it has checked the change. */
const FORBIDDEN_COMMAND = /\bgit\s+push\b|(?:^|[;&|(\s])gh\s/u;

const MS_PER_MINUTE = 60_000;

const UNATTENDED = [
  'You are running unattended inside boardwright, an agentic delivery pipeline. No one answers questions during this session.',
  'If you cannot go on without a decision from a person, stop and report status "blocked" with exactly what is missing.',
  'Report your result in the structured output: "completed" with a pull request title and body, or "blocked".',
].join('\n');

const agentReport = z.object({
  status: z.enum([
    'completed',
    'blocked',
  ]),
  summary: z.string(),
  pullRequestTitle: z.string().min(1).optional(),
  pullRequestBody: z.string().optional(),
  addressedThreadIds: z.array(z.string()).optional(),
});

/** The structured output every session must end with. */
export const REPORT_SCHEMA: Record<string, unknown> = z.toJSONSchema(agentReport);

const reviewReport = z.object({
  status: z.enum([
    'completed',
    'blocked',
  ]),
  summary: z.string(),
  verdict: z.enum([
    'approve',
    'changes',
  ]),
  comments: z.array(z.object({
    path: z.string().min(1),
    line: z.int().positive(),
    body: z.string().min(1),
  })),
});

/** The structured output a review session must end with. */
export const REVIEW_REPORT_SCHEMA: Record<string, unknown> = z.toJSONSchema(reviewReport);

/** The tools a reviewing agent may use: it reads and runs checks, it never edits. */
export const REVIEW_TOOLS: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
  'Bash',
];

const WRITE_TOOLS: readonly string[] = [
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
];

/** Environment variables, some unset. */
type Environment = Record<string, string | undefined>;

/** The part of the SDK the provider calls; tests replace it. */
export type QueryFunction = (params: {
  prompt: string;
  options: Options;
}) => AsyncIterable<SDKMessage>;

/** What the provider can be given instead of its defaults. */
export interface ClaudeProviderOptions {
  readonly query?: QueryFunction;

  /** The environment the agent's process starts from, before the tokens are removed. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/**
 * The Claude provider: one Claude Agent SDK session per stage run.
 *
 * @remarks
 * Credentials are whatever the Agent SDK resolves from the environment: an API key or a cloud provider
 * (ADR 0004). The provider never reads, stores or refreshes them.
 */
export class ClaudeAgentProvider implements AgentProvider {
  private readonly query: QueryFunction;

  private readonly environment: Readonly<Record<string, string | undefined>>;

  constructor(options: ClaudeProviderOptions = {}) {
    this.query = options.query ?? sdkQuery;
    this.environment = options.environment ?? process.env;
  }

  /** Runs the session to its result, aborting it when the stage's time runs out. */
  async run(request: AgentRequest): Promise<AgentResult> {
    const abort = new AbortController();

    const timer = setTimeout(
      () => {
        abort.abort();
      },
      request.timeoutMs,
    );

    try {
      let result: SDKResultMessage | undefined;

      for await (const message of this.query({
        prompt: request.prompt,
        options: this.optionsFor(
          request,
          abort,
        ),
      })) {
        if (message.type === 'result') {
          result = message;
        }
      }

      return abort.signal.aborted ? timedOut(request) : toAgentResult(
        result,
        request.task,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return abort.signal.aborted ? timedOut(request) : failed(`The agent session failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The SDK options of a run; exposed for tests and for reading what a session is allowed to do. */
  optionsFor(
    request: AgentRequest,
    abort: AbortController,
  ): Options {
    const isReview = request.task === 'review';

    const hasContextBase = existsSync(join(
      request.cwd,
      '.context',
    ));

    const mcpServers: Record<string, McpServerConfig> = hasContextBase
      ? {
          dotcontext: {
            type: 'stdio',
            command: 'npx',
            args: [
              '-y',
              '@dotcontext/mcp@1.1.1',
            ],
          },
        }
      : {};

    return {
      cwd: request.cwd,
      ...request.model === undefined ? {} : { model: request.model },
      maxTurns: request.maxTurns,
      permissionMode: 'dontAsk',
      allowedTools: [
        ...isReview ? REVIEW_TOOLS : STAGE_TOOLS,
        ...hasContextBase ? DOTCONTEXT_TOOLS : [],
      ],
      disallowedTools: [
        ...DENIED_TOOLS,
        ...isReview ? WRITE_TOOLS : [],
      ],
      settingSources: ['project'],
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: UNATTENDED,
      },
      outputFormat: {
        type: 'json_schema',
        schema: isReview ? REVIEW_REPORT_SCHEMA : REPORT_SCHEMA,
      },
      hooks: {
        PreToolUse: [{
          hooks: [guardTools(
            request.cwd,
            request.deniedPaths,
          )],
        }],
      },
      mcpServers,
      env: withoutTokens(this.environment),
      abortController: abort,
      persistSession: false,
    };
  }
}

/**
 * A `PreToolUse` hook that denies writes to denied paths or outside the worktree, and commands that push
 * or call GitHub.
 *
 * @remarks
 * This is the first line; the core checks the diff again before anything is pushed, because a shell
 * command can still write a file this hook cannot see.
 */
export function guardTools(
  cwd: string,
  deniedPaths: readonly string[],
): HookCallback {
  return (input) => {
    if (input.hook_event_name !== 'PreToolUse') {
      return Promise.resolve({});
    }

    const reason = deniedReason(
      cwd,
      deniedPaths,
      input.tool_name,
      input.tool_input,
    );

    return Promise.resolve(reason === undefined ? {} : deny(reason));
  };
}

function deniedReason(
  cwd: string,
  deniedPaths: readonly string[],
  toolName: string,
  toolInput: unknown,
): string | undefined {
  const fields = typeof toolInput === 'object' && toolInput !== null ? toolInput as Record<string, unknown> : {};

  if (FILE_TOOLS.has(toolName)) {
    const target = fields.file_path ?? fields.notebook_path;

    return typeof target === 'string' ? pathProblem(
      cwd,
      deniedPaths,
      target,
    ) : undefined;
  }

  if (
    toolName === 'Bash'
    && typeof fields.command === 'string'
    && FORBIDDEN_COMMAND.test(fields.command)
  ) {
    return 'boardwright pushes the branch and opens the pull request after checking the change; commit and stop.';
  }

  return undefined;
}

function pathProblem(
  cwd: string,
  deniedPaths: readonly string[],
  target: string,
): string | undefined {
  const path = relative(
    cwd,
    isAbsolute(target) ? target : join(
      cwd,
      target,
    ),
  ).replaceAll(
    '\\',
    '/',
  );

  if (
    path.startsWith('..')
    || isAbsolute(path)
  ) {
    return `${target} is outside the worktree.`;
  }

  return findDeniedPaths(
    [path],
    deniedPaths,
  ).length > 0 ? `${path} is a denied path for agents.` : undefined;
}

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

/** A copy of the environment without the GitHub tokens. */
export function withoutTokens(environment: Readonly<Environment>): Environment {
  const copy = { ...environment };

  for (const name of TOKEN_VARIABLES) {
    copy[name] = undefined;
  }

  return copy;
}

function toAgentResult(
  result: SDKResultMessage | undefined,
  task: AgentRequest['task'],
): AgentResult {
  if (result === undefined) {
    return failed('The agent session ended without a result.');
  }

  if (result.subtype !== 'success') {
    return failed(`The agent session stopped: ${result.subtype}.`);
  }

  if (task === 'review') {
    return toReviewResult(result.structured_output);
  }

  const report = agentReport.safeParse(result.structured_output);

  if (!report.success) {
    return failed('The agent finished without reporting its result in the expected form.');
  }

  const {
    status,
    summary,
    pullRequestTitle,
    pullRequestBody,
  } = report.data;

  return {
    status,
    summary,
    pullRequest: pullRequestTitle === undefined ? undefined : {
      title: pullRequestTitle,
      body: pullRequestBody ?? '',
    },
    review: undefined,
    addressedThreadIds: report.data.addressedThreadIds ?? [],
  };
}

function toReviewResult(output: unknown): AgentResult {
  const report = reviewReport.safeParse(output);

  if (!report.success) {
    return failed('The agent finished without reporting its review in the expected form.');
  }

  return {
    status: report.data.status,
    summary: report.data.summary,
    pullRequest: undefined,
    addressedThreadIds: [],
    review: report.data.status === 'completed'
      ? {
          verdict: report.data.verdict,
          comments: report.data.comments,
        }
      : undefined,
  };
}

function timedOut(request: AgentRequest): AgentResult {
  return failed(`The agent session ran out of time after ${Math.round(request.timeoutMs / MS_PER_MINUTE)} minutes.`);
}

function failed(summary: string): AgentResult {
  return {
    status: 'failed',
    summary,
    pullRequest: undefined,
    review: undefined,
    addressedThreadIds: [],
  };
}

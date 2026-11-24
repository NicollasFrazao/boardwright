---
type: doc
name: architecture
description: Packages and their layer rules, the reconciliation loop, state on GitHub, stages and guard rails
category: architecture
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

# Architecture

## Architecture Overview

One core, two runtimes. The core decides; adapters touch the outside world; the runner and the Action
only wire them together. Every runtime runs the same `tick()`, so a pipeline behaves the same on a
laptop and in GitHub Actions.

```
            ┌──────────── packages/runner (CLI, daemon) ─────┐
            │            action/ (GitHub Action)              │   composition roots
            └───────────────┬───────────────────┬─────────────┘
                            │                   │
   packages/github ─────────┤                   ├───────── packages/agent-claude
   (BoardPort, RepoHostPort)│                   │          (AgentProvider)
                            ▼                   ▼
                    packages/core: application  (tick, stages, merge policy)
                                   domain       (pure types and rules)
```

## Packages

| Package | Layer | Responsibility | Issue |
| --- | --- | --- | --- |
| `packages/core` (`src/domain`) | Domain | Work items, stages, run markers, guard-rail and merge-policy rules; pure | #3 |
| `packages/core` (`src/application`) | Application | Config schema (zod), ports, `tick()` | #3 |
| `packages/context` | Infrastructure | `ContextProvider`: the repository's dotcontext base, or `AGENTS.md`/`CLAUDE.md` | #3 |
| `packages/github` | Infrastructure | `BoardPort` on a Projects v2 board of a user or an organization (GraphQL); `RepoHostPort` on the REST API: issues, comments, the labeller from the issue's events, pull requests, labels, files | #4 |
| `packages/git` | Infrastructure | `WorkspacePort` on the git CLI: a cached clone per repository, a worktree per run, push without force | #5 |
| `packages/agent-claude` | Infrastructure | `AgentProvider` on the Claude Agent SDK: a closed tool list, a `PreToolUse` guard, a token-free environment, a structured report | #5 |
| `packages/runner` | Interface | CLI: `doctor`, `once --dry-run`, `init` (#4); `once` with agents (#5) and the daemon `run` (#8) | #4, #5, #8 |
| `packages/testing` | (tests only) | Fakes of every port and a replay of the GitHub API; no `src` may import it | #4 |
| `action/` | Interface | GitHub Action: one `tick()` per event | #8 |

## Layer rules

Checked by dependency-cruiser (`npm run check:architecture`, `.dependency-cruiser.cjs`):

- `core/src/domain` imports only Node built-ins.
- `core/src/application` imports only the domain and zod.
- `core` imports no other package.
- An adapter (`context`, `git`, `github`, `agent-*`) imports only the core, never another adapter.
- Outside the core, only its public API (`packages/core/src/index.ts`) is imported.
- Nothing imports `runner` or `action`: they are composition roots.
- Source never imports tests; published code never needs a devDependency at run time.
- No `src` imports `packages/testing`.
- No cycles, no orphan modules.

**Why:** a new provider or a new runtime is then one package that implements a port. Nothing in the
core changes, and nothing in one adapter can break another.

## The reconciliation loop

`tick()` is the only behaviour. It reads the board, decides what each item needs for its Status, and
acts. Each action is idempotent, so a tick can be repeated, interrupted or run by two runners without
doing the work twice:

1. Read the board; for each stage, take the items in its `when` Status.
2. Plan each item (`packages/core/src/application/tick.ts`): repository allowlist, open issue, trigger
   label added by someone with triage, then the markers decide (`domain/run-decision.ts`): start an
   attempt, wait for a run in flight, repair the Status after a success, or give up.
3. Claim: write a `started` marker, re-read the markers, and go on only if it is the earliest claim of
   that attempt (`isClaimWinner`); then move the Status to `claim`.
4. Run the stage in its own git worktree (`implement-stage.ts`): the repository's context, the prompt,
   the agent session.
5. Check the diff against the path denylist, push without force and open (or find) the pull request.
6. Write the outcome marker and move the Status: `succeeded` → `done`; `failed` → back to `when` for the
   next attempt; `blocked` (the agent asked a question) or `denied` (a denied path) → `blocked`, for a
   person.

At most `concurrency` runs start per tick; the rest are reported as `deferred`. An error on one item is
reported for that item and the tick goes on. `tick(dependencies, { dryRun: true })` plans without
writing anything.

## State lives on GitHub

There is no database ([ADR 0001](./adr/0001-github-as-the-state-store.md)). The Status of the item
says where it is; a hidden marker comment on the issue
(`<!-- boardwright:run v=1 stage=implement run=<id> attempt=<n> event=<event> -->`, `domain/run-marker.ts`)
records each run's start and outcome, so the next tick knows which run owns the item and how many
attempts were made. Events: `started`, `succeeded`, `failed`, `blocked`, `denied`, `gave-up`. A run
without an outcome after its timeout plus a 5-minute grace is presumed dead and counts as an attempt.
After the last attempt the pipeline writes `gave-up` and leaves the issue to a person; deleting that
comment lets it try again.

## Stages

| Stage | From Status | PREVC phase | What it does |
| --- | --- | --- | --- |
| refine (optional) | a column the board owner adds | P | Plan as an issue comment or a `.context/plans` file |
| implement | Ready | E | Branch `agent/issue-N`, change, local gate, pull request with `Closes #N` |
| review | In review | R | Reviews the head of `agent/issue-N`'s pull request read-only; posts a review that only comments, with line comments and a `<!-- boardwright:review v=1 verdict=… head=… -->` marker; never approves, never moves the card. A new push starts a new round; `maxAttempts` caps the rounds |
| address-feedback | In review | E/V | Fixes for unresolved threads and failing checks, up to `maxAttempts` |
| merge (opt-in) | In review | V | Native auto-merge when the merge policy passes |
| document (opt-in) | Done | C | Pull request updating the `.context` docs the change touched |

Each stage has a handler (`packages/core/src/application/stages.ts`) that says when it applies (review
needs an open pull request from the branch), what "its result is in place" means (implement: the pull
request is open; review: a review of the current head exists), and where the card goes after a run or
when the pipeline gives up (review leaves it where it is).

The playbook and the skills for each stage come from the target repository's `.context` through the
`ContextProvider` port (`packages/context`): with a `.context/agents` or `.context/skills` directory,
the dotcontext adapter reads the front matter (`agentType`, `skillSlug`, `phases`) of the files the
repository has; otherwise the plain adapter lists `AGENTS.md`, `CLAUDE.md` and `.claude/CLAUDE.md`. The
playbook is the stage's `context.agent`, overridden by the first matching label in
`context.agentByLabel` (`bug` → `bug-fixer`). The dotcontext MCP's own selection is not used: it adds
built-in agents and skills the repository may have removed (issue #3).

## Guard rails

Enforced in the core, so they hold for every provider:

- No merge outside the merge stage and its policy; no push to the base branch; no force-push; no
  token with bypass rights.
- Path denylist (default `.github/workflows/**` and secret files): checked in the agent session and
  again on the diff before pushing.
- The trigger label counts only when whoever added it has triage access; repositories outside the
  allowlist are ignored.
- `maxTurns`, a timeout and `maxAttempts` per stage. An ambiguous issue gets a comment and the run stops.

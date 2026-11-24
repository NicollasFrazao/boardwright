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
| `packages/github` | Infrastructure | Projects v2 (GraphQL), issues, pull requests, review threads, checks | #4 |
| `packages/agent-claude` | Infrastructure | `AgentProvider` on the Claude Agent SDK | #5 |
| `packages/runner` | Interface | CLI and daemon: `run`, `once`, `doctor`, `init` | #4, #8 |
| `action/` | Interface | GitHub Action: one `tick()` per event | #8 |

## Layer rules

Checked by dependency-cruiser (`npm run check:architecture`, `.dependency-cruiser.cjs`):

- `core/src/domain` imports only Node built-ins.
- `core/src/application` imports only the domain and zod.
- `core` imports no other package.
- An adapter (`github`, `agent-*`) imports only the core, never another adapter.
- Nothing imports `runner` or `action`: they are composition roots.
- Source never imports tests; published code never needs a devDependency at run time.
- No cycles, no orphan modules.

**Why:** a new provider or a new runtime is then one package that implements a port. Nothing in the
core changes, and nothing in one adapter can break another.

## The reconciliation loop

`tick()` is the only behaviour. It reads the board, decides what each item needs for its Status, and
acts. Each action is idempotent, so a tick can be repeated, interrupted or run by two runners without
doing the work twice:

1. Read the items whose Status is mapped to a stage, for the repositories in the allowlist.
2. For each item, evaluate the stage rule (`when`), the trigger checks and the guard rails.
3. Claim: write the run marker (stage, run id, attempt) and move the Status (`claim`).
4. Run the stage in its own git worktree through the `AgentProvider`.
5. Check the result (path denylist, the repository's gate), then move the Status (`done`) or comment
   why not.

## State lives on GitHub

There is no database ([ADR 0001](./adr/0001-github-as-the-state-store.md)). The Status of the item
says where it is; a hidden marker comment on the issue
(`<!-- boardwright:run stage=… id=… attempt=… -->`) says which run owns it and how many attempts
were made. A local lock file per item only prevents two runs on the same machine.

## Stages

| Stage | From Status | PREVC phase | What it does |
| --- | --- | --- | --- |
| refine (optional) | a column the board owner adds | P | Plan as an issue comment or a `.context/plans` file |
| implement | Ready | E | Branch `agent/issue-N`, change, local gate, pull request with `Closes #N` |
| review | In review | R | Comments and a verdict in the run marker; never approves |
| address-feedback | In review | E/V | Fixes for unresolved threads and failing checks, up to `maxAttempts` |
| merge (opt-in) | In review | V | Native auto-merge when the merge policy passes |
| document (opt-in) | Done | C | Pull request updating the `.context` docs the change touched |

The playbook and the skills for each stage come from the target repository's `.context` through the
`ContextProvider` port (dotcontext adapter, plain fallback). See issue #3 for the dotcontext tools used.

## Guard rails

Enforced in the core, so they hold for every provider:

- No merge outside the merge stage and its policy; no push to the base branch; no force-push; no
  token with bypass rights.
- Path denylist (default `.github/workflows/**` and secret files): checked in the agent session and
  again on the diff before pushing.
- The trigger label counts only when whoever added it has triage access; repositories outside the
  allowlist are ignored.
- `maxTurns`, a timeout and `maxAttempts` per stage. An ambiguous issue gets a comment and the run stops.

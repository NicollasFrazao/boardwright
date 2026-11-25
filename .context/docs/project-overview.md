---
type: doc
name: project-overview
description: What boardwright does, for whom, and what it deliberately does not do
category: overview
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

# Project overview

## Project Overview

boardwright runs agentic delivery pipelines from a GitHub Project (v2). The board is the source of
truth: each Status column maps to an agent role (refine, implement, review, address feedback, merge),
a config file says which, and the tool reconciles the board with what the agents do. It is
for teams and solo maintainers who already plan in GitHub Projects and want agents to take cards
through the same flow a person would, with the same rulesets and checks.

## Codebase Reference

> **Semantic Snapshot**: Use `context({ action: "getMap", section: "all" })` for the generated stack,
> layers, key files and dependency hotspots once the packages land.

## Quick Facts

- Root: the repository root; npm workspaces under `packages/`.
- Language: TypeScript (strict, ESM) on Node 26, the active LTS.
- Entry points (planned): the CLI in `packages/runner/src/cli.ts` and the Action in `action/`.
- Roadmap: umbrella issue #1, one sub-issue per phase (#2–#9).

## Entry Points

None yet: phase 1 (#2) ships the engineering baseline only. The first code is the core (#3).

| Planned entry point | Package | Issue |
| --- | --- | --- |
| `boardwright run` / `once` / `doctor` / `init` | `packages/runner` | #4, #8 |
| GitHub Action, one `tick()` per event | `action/` | #8 |

## Key Exports

Planned public surface of `packages/core`: the config schema, the ports (`BoardPort`,
`RepoHostPort`, `AgentProvider`, `WorkspacePort`, `ContextProvider`, `Clock`, `Logger`), `tick()` and
the merge policy. Everything else is internal.

## File Structure & Code Organization

- `packages/` — workspaces; see [architecture](./architecture.md) for each package's layer.
- `eslint-rules/` — local readability rules, with RuleTester tests.
- `scripts/` — export and check of the agent surfaces.
- `.context/` — this knowledge base: `docs/`, `agents/`, `skills/`.
- `.github/` — CI, CodeQL, Dependabot, the board pipeline, PR and issue templates.

## Technology Stack Summary

Node 26 and TypeScript 5.9 in strict mode with ESM. ESLint 10 with typescript-eslint
`strictTypeChecked`, `eslint-plugin-sonarjs` and local readability rules; knip and dependency-cruiser;
Vitest 5 with v8 coverage. Runtime dependencies are added per package as they land: zod (config),
Octokit and GraphQL (GitHub), `@anthropic-ai/claude-agent-sdk` (Claude provider) and the dotcontext MCP
client (context).

## What it does not do

- It does not replace the board's built-in workflows (item added → Todo, linked PR → In review,
  closed → Done); it works with them.
- It never creates Status options, fields or views. `doctor` reports what is missing; the board's
  owner decides.
- It never merges by default. Agentic merge is an opt-in stage behind a deterministic policy
  ([ADR 0003](./adr/0003-deterministic-merge-policy.md)).
- It does not store agent credentials ([ADR 0002](./adr/0002-local-runner-and-action.md)).

## Getting Started Checklist

1. Read [development conventions](./development-conventions.md) before editing anything.
2. `npm ci`, then the local gate in [development workflow](./development-workflow.md).
3. Pick an issue from the roadmap (#1) and branch with the right prefix.

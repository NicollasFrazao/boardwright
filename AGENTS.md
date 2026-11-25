# boardwright: context index

The knowledge base of this repository, for people and for coding agents. Start with the project
overview, then open the guide the task needs.

## Mandatory for anyone editing this repository

**Before editing any file, read [`development-conventions.md`](/.context/docs/development-conventions.md).**
It is the normative file: the quality gate to run before every commit, the layer rules, the agent
safety rules you must not break, the documentation and readability rules the lint enforces, commits
and branches, and the language everything is written in. Its rules are commands, not background
reading.

Two more readings, each with the moment it applies:

- **before changing `tick()`, a stage rule, a guard rail or the merge policy** —
  [`architecture.md`](/.context/docs/architecture.md), sections "The reconciliation loop" and
  "Guard rails", and [`security.md`](/.context/docs/security.md), "Threat model";
- **before changing the run marker or anything a runner writes to GitHub** —
  [ADR 0001](/.context/docs/adr/0001-github-as-the-state-store.md), because runners of different
  versions read the same board.

> **This file is the source of the agent surfaces.** `AGENTS.md`, `.claude/CLAUDE.md` and
> `.github/copilot-instructions.md` are byte-for-byte copies of `.context/docs/README.md`, written by
> `npm run export:context` and verified by `npm run check:context` (a CI job). Edit this file, never
> a copy. The rules themselves are not copied into the surfaces: they live in
> `development-conventions.md`, one hop away, so there is a single place to change them.

## Guides

| Guide | What it answers |
| --- | --- |
| [Project overview](/.context/docs/project-overview.md) | What boardwright does, for whom, and what it deliberately does not do |
| [Architecture](/.context/docs/architecture.md) | Packages and layer rules, the reconciliation loop, stages, guard rails |
| [Development conventions](/.context/docs/development-conventions.md) | **Normative.** Quality gate, agent safety rules, code rules, commits, branches, PRs, language |
| [Development workflow](/.context/docs/development-workflow.md) | Setup, day-to-day commands, recipes (new stage, new provider, new option) |
| [Testing strategy](/.context/docs/testing-strategy.md) | Fake ports instead of network mocks, fixtures, coverage |
| [Data flow](/.context/docs/data-flow.md) | An issue from Ready to Done, integrations, failure handling |
| [Glossary](/.context/docs/glossary.md) | Domain vocabulary and the only abbreviations allowed in names |
| [Security](/.context/docs/security.md) | Threat model, tokens, credentials, known gaps, how to report a vulnerability |
| [Tooling](/.context/docs/tooling.md) | Every npm script, hook and CI job, and what each one catches |
| [Technical debt](/.context/docs/tech-debt.md) | Known gaps, with the reason they are still open |
| [Decision records](/.context/docs/adr/README.md) | GitHub as the state store, two runtimes, the deterministic merge policy |

## Agents and skills

Playbooks for the roles the pipeline itself runs, so this repository is developed the way it
develops others:

- Agents: [`architect-specialist`](/.context/agents/architect-specialist.md) (refine),
  [`feature-developer`](/.context/agents/feature-developer.md) and [`bug-fixer`](/.context/agents/bug-fixer.md)
  (implement), [`test-writer`](/.context/agents/test-writer.md),
  [`code-reviewer`](/.context/agents/code-reviewer.md) and [`security-auditor`](/.context/agents/security-auditor.md)
  (review), [`documentation-writer`](/.context/agents/documentation-writer.md) (document),
  [`devops-specialist`](/.context/agents/devops-specialist.md) (CI and the Action).
- Skills: [`feature-breakdown`](/.context/skills/feature-breakdown/SKILL.md),
  [`bug-investigation`](/.context/skills/bug-investigation/SKILL.md),
  [`test-generation`](/.context/skills/test-generation/SKILL.md),
  [`code-review`](/.context/skills/code-review/SKILL.md), [`pr-review`](/.context/skills/pr-review/SKILL.md),
  [`security-audit`](/.context/skills/security-audit/SKILL.md),
  [`commit-message`](/.context/skills/commit-message/SKILL.md),
  [`documentation`](/.context/skills/documentation/SKILL.md).

## Repository map

- `packages/core/` — domain (markers, run decisions, guard rails) and application (config, ports, `tick()`)
- `packages/context/` — the `ContextProvider` adapters: dotcontext base and plain fallback
- `packages/github/` — the GitHub adapters: the Projects v2 board and the repository host
- `packages/runner/` — the CLI (`doctor`, `once`, `run`, `init`) and the GitHub Action's entry (`action.ts`)
- `action.yml`, `dist/` — the GitHub Action and its committed build (`npm run build:action`)
- `examples/` — example configs (minimal, full pipeline, agentic merge), each checked against the schema by a test
- `packages/testing/` — fakes of every port and the GitHub API replay, for tests only
- `packages/git/` — the git workspaces: a cached clone per repository, a worktree per run
- `packages/agent-claude/` — the Claude provider on the Claude Agent SDK
- `eslint-rules/` — local readability rules, with RuleTester tests
- `scripts/` — `check-context-surfaces.mjs` (export and check of the agent surfaces) and `build-action.mjs` (the Action's `dist/`)
- `.context/` — this knowledge base
- `.github/` — CI, CodeQL, Dependabot, the board pipeline, PR and issue templates, CODEOWNERS

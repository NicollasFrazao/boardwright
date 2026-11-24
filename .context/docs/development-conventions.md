---
type: doc
name: development-conventions
description: Normative conventions — quality gate, layer rules, agent safety rules, documentation and readability, commits, branches, PRs, language
category: workflow
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

# Development conventions

What is mandatory when changing this repository. Setup and step-by-step recipes are in
[development-workflow.md](development-workflow.md); this file holds only what must hold without
anything prompting it, written as commands.

## Quality gate

**Before every commit, run the gate, one command at a time:**

```bash
npm run lint                # ESLint, --max-warnings 0
npm run typecheck           # tsc --noEmit, strict
npm run check:architecture  # dependency-cruiser layer rules
npm run check:unused        # knip: unused files, exports, types, dependencies
npm run test:coverage       # unit + tooling, 80% on all four metrics
npm run check:context       # agent surfaces are copies of .context/docs/README.md
```

These are exactly the CI jobs (`lint`, `typecheck`, `architecture`, `unused`, `test`, `context`,
plus `audit` and `commitlint`), one job per command, every one a required check on `master`. A green
local gate means a green CI.

- Run them **one at a time**; in parallel they compete for memory on a small machine.
- The `pre-commit` hook runs ESLint on the staged files only, and `commit-msg` runs commitlint. They
  are a fast first filter, not the gate.
- A rule is fixed in the code, never silenced. A targeted `eslint-disable-next-line <rule>` is
  allowed only with a comment on the same line saying why the rule does not apply there. No
  file-level or blanket disables. The same holds for knip and dependency-cruiser exceptions: each
  one carries its reason next to it.
- Coverage stays at or above 80% on statements, branches, functions and lines. A drop is fixed with
  tests, never by lowering `COVERAGE_THRESHOLD` in `vitest.config.ts` or excluding files.

## Layer rules

Enforced by `npm run check:architecture`. See [architecture.md](architecture.md) for the reasoning.

- `packages/core/src/domain/` imports nothing outside itself except Node built-ins.
- `packages/core/src/application/` imports only the domain and zod. It reaches GitHub, git, the agent
  and the context base through ports; it never imports an SDK.
- `packages/core` imports no other package. An adapter (`context`, `github`, `agent-*`) imports only the
  core, through its public API (`packages/core/src/index.ts`), never another adapter.
- `packages/runner` and `action/` are composition roots: the only modules that read `process.env`,
  read tokens or construct clients. Nothing imports them.
- No cycles. No orphan module.

## Agent safety rules you must not break

The full list is in [architecture.md](architecture.md), "Guard rails". In short: no merge outside the
merge stage and its policy, no push to the base branch, no force-push, the path denylist is checked
twice, the trigger needs triage access, and every stage has turn, time and attempt limits. A pull
request that touches `tick()`, a stage rule, a guard rail or the merge policy states what an agent can
do after the change that it could not do before, and adds a test that fails without the change.

- Every action of `tick()` is idempotent. A new action says how a repeated or concurrent tick
  detects that it already happened (the run marker, the Status, the pull request).
- A new stage never needs a new Status option to exist: it reads the board as it is, and `doctor`
  reports what is missing.
- The run marker format is a public contract: runners of different versions read the same board.
  Changing it is a `!` commit.
- Tokens and agent credentials are read only in the composition roots and never logged, never
  written to a marker, a comment or an artifact.

## Documentation in code (TSDoc)

Enforced by `eslint-plugin-jsdoc` and the local `jsdoc-tag-spacing` rule.

- **Every exported symbol has a doc comment**: classes, functions, interfaces, type aliases and
  exported constants. One summary sentence saying what it does for the caller; `@remarks` for the why.
- `@param` and `@returns` only when they add something the type does not say. When a function
  documents one parameter it documents all of them.
- `@throws {@link ErrorClass} when ...` for every error a caller must handle. A function with a
  `throw` statement and no `@throws` fails the lint.
- Tag order: `@remarks`, `@typeParam`, `@param`, `@returns`, `@throws`, `@example`, `@see`. Exactly
  one blank line between kinds, one after the summary.
- Comments explain **why**, not what. No commented-out code, no `TODO` / `FIXME`: deferred work is an
  issue, listed in [tech-debt.md](tech-debt.md).

## Readability rules

Enforced by ESLint, at error level:

- Cognitive complexity at most **15** per function (`sonarjs/cognitive-complexity`); nesting at most
  **3** (`max-depth`); at most **4** parameters (`@typescript-eslint/max-params`) — beyond that, take
  an object with a named interface.
- One statement per line. With more than one item, every parameter, argument, property and array
  element goes on its own line (`local/one-per-line`). A condition with `&&` / `||` puts each clause
  on its own line, operator leading (`local/multiline-if-condition`). Control-block bodies are never
  inline (`curly: all`).
- Blank lines around multi-line blocks and statements, and before `return`, `throw` and control
  statements.
- No magic numbers in `packages/*/src`: name them (`DEFAULT_MAX_ATTEMPTS`, `POLL_INTERVAL_MS`).
  Tests are exempt.
- No unused code: variables, imports, arguments, private members, dead stores (`sonarjs`,
  `@typescript-eslint/no-unused-vars`) and no unused file, export or dependency (`knip`).
- No string literal duplicated three times or more in source (`sonarjs/no-duplicate-string`).

## Naming

- Domain vocabulary from [glossary.md](glossary.md): `board`, `item`, `status`, `stage`, `run`,
  `claim`, `marker`, `attempt`, `tick`, `provider`, `playbook`, `merge policy`.
- No abbreviations except those in the glossary. `id-length` rejects one-letter names.
- Booleans read as predicates (`isClaimed`, `hasUnresolvedThreads`); units are in the name
  (`timeoutMs`, `pollIntervalMs`).

## Language

Everything is in English: identifiers, comments, log messages, error messages, documentation,
commit messages, PR and issue text.

## Branches, commits and pull requests

- `master` is the default branch and is never pushed to directly. Branch prefixes: `feat/`, `fix/`,
  `docs/`, `refactor/`, `chore/`, `test/`, `ci/`.
- Every change starts from an issue; the pull request closes it with an English keyword
  (`Closes #12`). Anything else does not link.
- Commits follow **Conventional Commits** (`type(scope): description`), checked by commitlint in the
  `commit-msg` hook and, for every commit of a pull request, in CI. Scopes are package names (`core`,
  `github`, `agent-claude`, `runner`, `action`) or `context`, `ci`, `deps`.
- **The commit type is the version.** `feat` → minor; `fix`, `perf`, `refactor` → patch; a `!` after
  the type or a `BREAKING CHANGE:` footer → major; `docs`, `test`, `build`, `ci`, `chore`, `style` →
  no release.
- Small pull requests, one concern each. The PR template asks for the what and why, the issue, the
  verification **as results** ("95/95 tests"), and the risks.

## Context base

`.context/docs/` is the source. `AGENTS.md`, `.claude/CLAUDE.md` and
`.github/copilot-instructions.md` are copies of `.context/docs/README.md` written by
`npm run export:context`; edit the source and re-export. Never generate the surfaces with the
dotcontext `exportDocs`, `exportContext` or `reverseSync` tools: they write targets this repository
does not control and re-import generated files as sources. A new file of a kind dotcontext scaffolds
(its docs, agents, skills, plans) gets its first version through the dotcontext MCP (`context` `init`
or `scaffoldPlan`, then `fillSingle`); files it has no scaffold for (these conventions, the technical
debt, the ADRs) are written directly. Later edits are direct, keeping `generated` and `status` in the
front matter accurate.

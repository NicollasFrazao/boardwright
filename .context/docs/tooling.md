---
type: doc
name: tooling
description: Every npm script, hook and CI job, and what each one catches
category: tooling
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

# Tooling

## Tooling & Productivity Guide

## npm scripts

| Script | Tool | Catches |
| --- | --- | --- |
| `lint` | ESLint 10 flat config (`eslint.config.js`) | Type-aware errors (`strictTypeChecked`), Sonar rules (cognitive complexity ≤ 15, dead code, duplicates), readability and layout, missing TSDoc |
| `typecheck` | `tsc --noEmit` (`tsconfig.json`) | Type errors under `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| `check:architecture` | dependency-cruiser (`.dependency-cruiser.cjs`) | Layer violations, cycles, orphans, devDependencies at run time |
| `check:unused` | knip (`knip.jsonc`) | Unused files, exports, types and dependencies |
| `test` / `test:coverage` | Vitest 5 (`vitest.config.ts`) | Behaviour; coverage below 80% fails |
| `export:context` / `check:context` | `scripts/check-context-surfaces.mjs` | Agent surfaces drifting from `.context/docs/README.md` |
| `boardwright -- <command>` | `packages/runner/src/cli.ts` on Node 26 | Runs the CLI from source (see development-workflow.md) |
| `build:action` | esbuild (`scripts/build-action.mjs`) | Builds the Action into `dist/` (see below) |
| `build:npm` | `scripts/build-npm.mjs` | Writes the `boardwright` npm package into `build/npm`: `dist/cli.js`, the README, the licenses, and a `package.json` whose one dependency is the Agent SDK at the locked version |

The test override in `eslint.config.js` (magic numbers and repeated strings allowed) also covers
`packages/testing/src`, which is test code. Coverage leaves out the two entries, `packages/runner/src/cli.ts`
and `packages/runner/src/action.ts`: they only bind the process to `runProgram`, `actionCommand` and
`installPackages`, which are tested; the CI job `action` runs the Action itself.

## The Action's build (`dist/`)

`action.yml` runs `dist/index.js` on `node24`, so `dist/` is committed. `npm run build:action` writes:

- `index.js`, from `packages/runner/src/action.ts`: reads the inputs, installs the agent packages, then
  runs `cli.js` once as a child process with an environment built for it;
- `cli.js`, the CLI bundled for Node 24, without `@anthropic-ai/claude-agent-sdk`: that package is under
  Anthropic's commercial terms, and its native binary is hundreds of megabytes;
- `agent-packages.json`, the SDK and its native binaries as `package-lock.json` pins them (tarball and
  `sha512` integrity), which `index.js` downloads into `dist/node_modules` and checks before unpacking;
- `THIRD_PARTY_LICENSES.txt`, the license of every npm package inside the bundle.

**Rebuild and commit `dist/` in every pull request that changes runtime code or a runtime dependency**,
including a Dependabot one; the `action` job fails otherwise. The build is deterministic, so a rebuild
with nothing changed leaves `dist/` as it is.


## Local rules (`eslint-rules/`)

| Rule | Enforces |
| --- | --- |
| `local/one-per-line` | One parameter, argument, property or element per line when there is more than one |
| `local/multiline-if-condition` | One clause per line in `&&` / `||` conditions, operator leading |
| `local/block-multiline` | No inline control-block bodies |
| `local/jsdoc-tag-spacing` | One blank line between TSDoc tag kinds |

## Git hooks

- `pre-commit` — lint-staged: ESLint on staged files; `check:context` when a surface or its source is staged.
- `commit-msg` — commitlint (Conventional Commits).

## CI jobs (`.github/workflows/ci.yml`)

One job per check, so each can be a required status check: `lint`, `typecheck`, `architecture`,
`unused`, `test`, `audit` (production dependencies, high and above), `context`, `action` (`dist/` is the
build of the sources, the Action installs the agent and reaches the CLI on Node 24, and the npm package
builds and packs), `commitlint` (every commit of a pull request). `release.yml` publishes the npm
package when a GitHub release is published (see development-workflow.md, "Branching & Releases"). `codeql.yml` runs CodeQL (`security-and-quality`) on pushes, pull requests
and weekly, leaving out `dist/`, the bundle of sources it already analyzes.

## Board pipeline (`.github/workflows/pipeline.yml`)

Calls the shared `board-sync` and `agent` workflows of `NicollasFrazao/.github`, pinned by commit.
Each job is off until its repository variable (`BOARD_SYNC_ENABLED`, `AGENT_ENABLED`) is `true`. Once
the boardwright Action is released, this repository moves to it (#9).

## dotcontext

The `.context` base is maintained with the dotcontext MCP (`@dotcontext/mcp`). Use `context`
(`check`, `fillSingle`, `getMap`), `agent` and `skill`; never `sync` `exportDocs`, `exportContext` or
`reverseSync` (see [development-conventions.md](development-conventions.md), "Context base").

---
type: doc
name: testing-strategy
description: Test layout, fake ports instead of network mocks, fixtures of real .context bases, coverage
category: testing
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

# Testing strategy

## Testing Strategy

The core is tested through its ports with in-memory fakes, never with network mocks: a fake board, a
fake repository host, a fake agent provider and a fake clock. That keeps every stage rule, guard rail
and policy condition testable in milliseconds and makes concurrency cases (two runners, a run that
dies) ordinary tests.

## Test Types

| Project | Files | What it covers |
| --- | --- | --- |
| `unit` | `packages/*/test/**/*.test.ts` | Domain rules, `tick()` with fake ports, config parsing, adapters against recorded payloads |
| `tooling` | `eslint-rules/**/*.test.mjs`, `scripts/**/*.test.mjs` | The local ESLint rules (RuleTester) and the agent-surface scripts |

The test doubles live in `packages/testing` and are imported as `@boardwright/testing`: `scenario()` wires
fakes of every port around one triggered issue, and `GitHubReplay` is a `fetch` for Octokit that answers
from canned routes and records every request. A request no route matches fails with its method and
path, so a missing fixture is never mistaken for a 404.

End-to-end runs against a real board and a sandbox repository are manual checks listed in the pull
request of each phase (#5–#8), not CI jobs: they need tokens and an agent.

## Running Tests

```bash
npm test                # everything
npm run test:unit       # one project
npm run test:coverage   # with the 80% gate, as CI runs it
```

## Quality Gates

- 80% on statements, branches, functions and lines over `packages/*/src` (`vitest.config.ts`).
- A change to a stage rule, a guard rail or the merge policy comes with a test that fails without it.
- Merge-policy conditions are table tests: one row per condition, each failing on its own.

## Fixtures

- GitHub payloads in the shape the real API returned when the adapters were run read-only against a
  real board (`packages/github/test`), with ids and logins replaced.
- Copies of real `.context` bases (agents and skills with their `phases` front matter) to test how a
  stage's prompt is assembled, plus a repository without `.context` for the plain fallback.

## Troubleshooting

- A test that depends on time uses the fake `Clock`, never `Date.now()`; wall clocks can move
  backwards on WSL2.

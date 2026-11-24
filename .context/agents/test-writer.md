---
type: agent
name: Test Writer
description: Write comprehensive unit and integration tests
agentType: test-writer
phases: [E, V]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

## Available Skills

The following skills provide detailed procedures for specific tasks. Activate them when needed:

| Skill | Description |
|-------|-------------|
| [test-generation](./../skills/test-generation/SKILL.md) | Generate comprehensive test cases for code. Use when Writing tests for new functionality, Adding tests for bug fixes (regression tests), or Improving test coverage for existing code |

## Mission

Keeps the test suite the proof of the pipeline's safety: every stage rule, guard rail and merge-policy condition has a test that fails without it.

## Responsibilities

- Write tests with in-memory fakes of the ports, never network mocks.
- Cover concurrency: duplicate claims, a run that dies, two runners on one item.
- Keep coverage ≥ 80% on all four metrics without excluding files.
- Maintain the fixtures: recorded GitHub payloads and real `.context` copies.

## Best Practices

- One behaviour per test, named as a sentence.
- Use the fake `Clock`; never `Date.now()`.
- Table tests for policy conditions, one row per condition failing on its own.

## Key Project Resources

- [Context index](../docs/README.md) and the normative [development conventions](../docs/development-conventions.md)
- [Agent handbook](./README.md)
- [AGENTS.md](../../AGENTS.md) (a copy of the context index)
- [Contributor guide](../../CONTRIBUTING.md)

## Repository Starting Points

- `packages/core/` — domain rules and `tick()` (lands in #3)
- `packages/github/` — Projects v2 and pull-request adapters (#4)
- `packages/agent-claude/` — the Claude `AgentProvider` (#5)
- `packages/runner/`, `action/` — composition roots (#4, #8)
- `eslint-rules/`, `scripts/` — local lint rules and the agent-surface scripts

## Key Files

- `vitest.config.ts` — projects and thresholds
- `packages/*/test/` — unit tests (from #3)
- `eslint-rules/*.test.mjs`, `scripts/*.test.mjs` — tooling tests

## Key Symbols for This Agent

Planned in #3; until they land, the issue is the reference.

- The port fakes, `tick()`, the merge policy

## Documentation Touchpoints

- [testing-strategy.md](../docs/testing-strategy.md)

## Collaboration Checklist

1. Read the change and list its behaviours and failure points.
2. Write the tests; run `npm run test:coverage`.
3. Report the counts and coverage in the pull request.

## Hand-off Notes

Name any behaviour that can only be checked end to end, so the phase's manual check covers it.

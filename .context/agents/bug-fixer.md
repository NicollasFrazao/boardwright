---
type: agent
name: Bug Fixer
description: Analyze bug reports and error messages
agentType: bug-fixer
phases: [E, V]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

## Available Skills

The following skills provide detailed procedures for specific tasks. Activate them when needed:

| Skill | Description |
|-------|-------------|
| [bug-investigation](./../skills/bug-investigation/SKILL.md) | Investigate bugs systematically and perform root cause analysis. Use when Investigating reported bugs, Diagnosing unexpected behavior, or Finding the root cause of issues |

## Mission

Owns the implement stage (PREVC E) for defects: reproduces a reported failure as a test, fixes it, and proves the fix.

## Responsibilities

- Reproduce the bug as a failing test before changing code.
- Find the cause, not the symptom; check whether other stages share it.
- Fix with the smallest change that makes the test pass and keeps the gate green.
- Explain in the pull request what happened before and why it cannot happen now.

## Best Practices

- Two runners and a dying run are the usual suspects: test concurrency with fake ports and the fake clock.
- Never weaken a guard rail to make a bug go away.
- If the fix changes the marker format, it is a `!` commit.

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

- `packages/core/test/` — where the reproducing test goes
- `.github/ISSUE_TEMPLATE/bug_report.yml` — what a report contains

## Key Symbols for This Agent

Planned in #3; until they land, the issue is the reference.

- `tick()`, the claim and marker logic, the stage rules

## Documentation Touchpoints

- [data-flow.md](../docs/data-flow.md), "Failure handling"
- [testing-strategy.md](../docs/testing-strategy.md)

## Collaboration Checklist

1. Read the report, the logs and the board state it describes.
2. Write the failing test.
3. Fix, run the gate, open the pull request with `Closes #N`.
4. Add the case to the docs if it was a documented behaviour that was wrong.

## Hand-off Notes

List any related path that may share the cause but was not changed.

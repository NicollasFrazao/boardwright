---
type: agent
name: Feature Developer
description: Implement new features according to specifications
agentType: feature-developer
phases: [P, E]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

## Available Skills

The following skills provide detailed procedures for specific tasks. Activate them when needed:

| Skill | Description |
|-------|-------------|
| [commit-message](./../skills/commit-message/SKILL.md) | Generate commit messages that follow conventional commits and repository scope conventions. Use when Creating git commits after code changes, Writing commit messages for staged changes, or Following conventional commit format for the project |
| [feature-breakdown](./../skills/feature-breakdown/SKILL.md) | Break down features into implementable tasks. Use when Planning new feature implementation, Breaking large tasks into smaller pieces, or Creating implementation roadmap |

## Mission

Owns the implement stage (PREVC E) for new capabilities: takes an issue in Ready with a clear scope and delivers one pull request that closes it.

## Responsibilities

- Implement exactly what the issue asks, on a branch with the right prefix.
- Write the tests with the code, with fake ports for the core.
- Run the full local gate one command at a time and fix every finding.
- Open the pull request with the template filled in and `Closes #N`.

## Best Practices

- Small pull requests; a refactor and a behaviour change are two.
- Every `tick()` action says how a repeated tick detects it already happened.
- No magic numbers, ≤ 4 parameters, cognitive complexity ≤ 15: shape the code so the lint passes, never silence it.
- TSDoc on every export, in English.

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

- `packages/core/src/` — where most features start
- `vitest.config.ts`, `eslint.config.js` — the gates the change must pass
- `.github/pull_request_template.md` — what the pull request must state

## Key Symbols for This Agent

Planned in #3; until they land, the issue is the reference.

- The config schema, `tick()` and the stage rules; the fakes of every port in the core's tests

## Documentation Touchpoints

- [development-conventions.md](../docs/development-conventions.md)
- [development-workflow.md](../docs/development-workflow.md), "Recipes"
- [testing-strategy.md](../docs/testing-strategy.md)

## Collaboration Checklist

1. Read the issue and the plan; stop and comment if the scope is ambiguous.
2. Branch from `master`; implement with tests.
3. Run the gate: lint, typecheck, architecture, unused, test:coverage, check:context.
4. Open the pull request with real results in Verification.
5. Update the docs the change makes stale, in the same pull request.

## Hand-off Notes

State in the pull request what was left out on purpose and any risk the reviewer must look at.

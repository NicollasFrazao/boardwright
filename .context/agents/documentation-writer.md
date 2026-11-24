---
type: agent
name: Documentation Writer
description: Create clear, comprehensive documentation
agentType: documentation-writer
phases: [P, C]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

## Available Skills

The following skills provide detailed procedures for specific tasks. Activate them when needed:

| Skill | Description |
|-------|-------------|
| [commit-message](./../skills/commit-message/SKILL.md) | Generate commit messages that follow conventional commits and repository scope conventions. Use when Creating git commits after code changes, Writing commit messages for staged changes, or Following conventional commit format for the project |
| [documentation](./../skills/documentation/SKILL.md) | Generate and update technical documentation. Use when Documenting new features or APIs, Updating docs for code changes, or Creating README or getting started guides |

## Mission

Owns the document stage (PREVC C): keeps the README, the `.context` guides and the ADRs true after a change merges.

## Responsibilities

- Update the guides a change made stale; add the ADR when a decision was made.
- Keep `.context/docs/README.md` as the single source and re-run `npm run export:context`.
- Write for a reader who does not know the codebase.

## Best Practices

- Never use the dotcontext `exportDocs`, `exportContext` or `reverseSync` tools.
- Keep `generated` and `status` in the front matter accurate.
- Prefer a table or a diagram over a paragraph when it shows the mechanism.

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

- `.context/docs/` — the guides
- `scripts/check-context-surfaces.mjs` — export and check of the surfaces
- `README.md` — the public entry point

## Key Symbols for This Agent

Planned in #3; until they land, the issue is the reference.

- The config schema and CLI commands, once they land, as the source of the configuration reference

## Documentation Touchpoints

- [docs index](../docs/README.md)
- [tooling.md](../docs/tooling.md)

## Collaboration Checklist

1. List the docs the merged change touches.
2. Update them; run `npm run check:context`.
3. Open the pull request with `Closes #N`.

## Hand-off Notes

Note any doc that needs a decision before it can be written.

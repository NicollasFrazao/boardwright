---
type: skill
name: Commit Message
description: Generate commit messages that follow conventional commits and repository scope conventions. Use when Creating git commits after code changes, Writing commit messages for staged changes, or Following conventional commit format for the project
skillSlug: commit-message
phases: [E, C]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

1. Pick the type by the version it implies: `feat` minor; `fix`/`perf`/`refactor` patch; `!` major; `docs`/`test`/`build`/`ci`/`chore`/`style` none.
2. Scope by package (`core`, `github`, `agent-claude`, `runner`, `action`) or `context`, `ci`, `deps`.
3. Subject in the imperative, lower case, no period.
4. Body: what was wrong or missing and why this change; wrap at 72.
5. Footer: `Closes #N`; `BREAKING CHANGE:` when a contract (config, marker) breaks.

## Examples

```
fix(core): claim a board item only once per stage

Two runners that read the board in the same second both moved the item
to In Progress. The claim now writes the run marker first and backs off
when another marker for the same stage is newer.

Closes #12
```

## Quality Bar

- commitlint runs on every commit of a pull request.
- The pull request title is the squash commit: it follows the same rules.

## Resource Strategy

- Keep the procedure in this file; it is short enough to read on every run.
- Add `references/` only for a checklist too long to keep here, and link it from the workflow step that needs it.
- No `scripts/`: the repository's npm scripts are the deterministic helpers.

---
type: skill
name: Documentation
description: Generate and update technical documentation. Use when Documenting new features or APIs, Updating docs for code changes, or Creating README or getting started guides
skillSlug: documentation
phases: [P, C]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

1. List the guides the change makes stale (the docs index names each guide's scope).
2. Edit `.context/docs/` directly; new files of a kind dotcontext scaffolds start through the MCP.
3. Update `README.md` when a user-visible command or option changed.
4. Run `npm run export:context`, then `npm run check:context`.
5. Keep `generated` and `status` in the front matter accurate.

## Examples

```
Change: new config option `merge.maxChangedLines`
Docs: README configuration reference; architecture.md "Guard rails"; ADR 0003 consequences
```

## Quality Bar

- Never use dotcontext `exportDocs`, `exportContext` or `reverseSync`.
- Docs describe what the code does today; plans go in issues.

## Resource Strategy

- Keep the procedure in this file; it is short enough to read on every run.
- Add `references/` only for a checklist too long to keep here, and link it from the workflow step that needs it.
- No `scripts/`: the repository's npm scripts are the deterministic helpers.

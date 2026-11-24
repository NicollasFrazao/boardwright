---
type: skill
name: Code Review
description: Review code quality, patterns, and best practices. Use when Reviewing code changes for quality, Checking adherence to coding standards, or Identifying potential bugs or issues
skillSlug: code-review
phases: [R, V]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

1. Read the linked issue and the pull request description.
2. Check scope: the change does what the issue asks and nothing more.
3. Check the layer rules and the agent safety rules in `development-conventions.md`.
4. Check every `tick()` action for idempotency and concurrent ticks.
5. Check TSDoc, readability and that the docs touched by the change were updated.
6. Leave line comments with a fix; mark each as required or suggestion.

## Examples

```
Required: claimItem() moves the Status before writing the marker; a second runner
can claim in between. Write the marker first and re-read before moving.
Suggestion: name the 3 in retry() as DEFAULT_MAX_ATTEMPTS.
```

## Quality Bar

- A lint, knip or depcruise exception without a reason next to it is a required change.
- Any new tool given to an agent session gets the security-audit skill.
- Unresolved threads are counted before the review is called done.

## Resource Strategy

- Keep the procedure in this file; it is short enough to read on every run.
- Add `references/` only for a checklist too long to keep here, and link it from the workflow step that needs it.
- No `scripts/`: the repository's npm scripts are the deterministic helpers.

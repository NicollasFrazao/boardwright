---
type: skill
name: Bug Investigation
description: Investigate bugs systematically and perform root cause analysis. Use when Investigating reported bugs, Diagnosing unexpected behavior, or Finding the root cause of issues
skillSlug: bug-investigation
phases: [E, V]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

1. Restate the report as board state + events + expected vs actual.
2. Reproduce it as a failing test with fake ports and the fake clock.
3. Bisect the cause: stage rule, claim/marker, adapter payload, or provider.
4. Check whether other stages share the cause.
5. Hand the failing test and the cause to the bug-fixer.

## Examples

```
Report: issue claimed twice by two runners
Repro: two tick() calls over one fake board, same clock instant
Cause: claim moves the Status before writing the marker
Shared by: every stage with a claim
```

## Quality Bar

- No fix without a failing test first.
- Concurrency bugs are reproduced deterministically, never by sleeping.
- Logs and payloads in the report are scrubbed of tokens before quoting them.

## Resource Strategy

- Keep the procedure in this file; it is short enough to read on every run.
- Add `references/` only for a checklist too long to keep here, and link it from the workflow step that needs it.
- No `scripts/`: the repository's npm scripts are the deterministic helpers.

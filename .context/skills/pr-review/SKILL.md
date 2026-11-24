---
type: skill
name: Pr Review
description: Review pull requests against team standards and best practices. Use when Reviewing a pull request before merge, Providing feedback on proposed changes, or Validating PR meets project standards
skillSlug: pr-review
phases: [R, V]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

1. Confirm `Closes #N` links (`gh pr view <N> --json closingIssuesReferences`).
2. Confirm Verification states results, not "tested".
3. Run the code-review skill on the diff.
4. Check CI: every required job green; none renamed.
5. Record the verdict (`approve` or `changes`) — as a comment and, in the pipeline, in the run marker. Never approve or merge.

## Examples

```
Verdict: changes
- Required: Verification says "tests pass"; list the counts and coverage.
- Required: the pull request does not link the issue ("Fixes issue 12" is not a keyword).
```

## Quality Bar

- An unlinked pull request is never ready.
- The verdict is a record, not an approval: merging stays with the merge policy or a person.

## Resource Strategy

- Keep the procedure in this file; it is short enough to read on every run.
- Add `references/` only for a checklist too long to keep here, and link it from the workflow step that needs it.
- No `scripts/`: the repository's npm scripts are the deterministic helpers.

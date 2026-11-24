---
type: skill
name: Feature Breakdown
description: Break down features into implementable tasks. Use when Planning new feature implementation, Breaking large tasks into smaller pieces, or Creating implementation roadmap
skillSlug: feature-breakdown
phases: [P]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

1. Read the issue, its comments and the roadmap (#1) to place it in a phase.
2. List the behaviours as acceptance criteria a test can check.
3. Map each behaviour to a package and layer; flag a new port or a contract change (config schema, run marker).
4. Split into sub-issues that each fit one pull request and pass the gate on their own.
5. Write the plan as an issue comment (or `.context/plans/` through dotcontext `scaffoldPlan` + `fillSingle`).

## Examples

```
Issue: "Address-feedback stage"
Sub-issues:
1. core: stage rule — In review + unresolved threads or failing checks; maxAttempts
2. github: read review threads and check runs for a pull request
3. core: tick() action — push fixes, attempt counted in the marker
Acceptance: a thread is fixed; a 4th attempt comments and stops
```

## Quality Bar

- Every sub-issue names the tests that prove it.
- No sub-issue mixes a refactor with a behaviour change.
- Contract changes are called out explicitly; they are `!` commits.

## Resource Strategy

- Keep the procedure in this file; it is short enough to read on every run.
- Add `references/` only for a checklist too long to keep here, and link it from the workflow step that needs it.
- No `scripts/`: the repository's npm scripts are the deterministic helpers.

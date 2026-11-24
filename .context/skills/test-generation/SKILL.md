---
type: skill
name: Test Generation
description: Generate comprehensive test cases for code. Use when Writing tests for new functionality, Adding tests for bug fixes (regression tests), or Improving test coverage for existing code
skillSlug: test-generation
phases: [E, V]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

1. List the behaviours and failure points of the change.
2. Use the in-memory fakes of the ports; add a fake only in the core's test helpers.
3. Write one test per behaviour, named as a sentence; table tests for policy conditions.
4. Run `npm run test:coverage` and keep all four metrics ≥ 80%.

## Examples

```
it('does not claim an item another run claimed in the same tick', ...)
it.each(policyRows)('blocks the merge when $condition fails', ...)
```

## Quality Bar

- No network mocks in the core's tests.
- Time comes from the fake `Clock`.
- A guard-rail test fails when the guard rail is removed.

## Resource Strategy

- Keep the procedure in this file; it is short enough to read on every run.
- Add `references/` only for a checklist too long to keep here, and link it from the workflow step that needs it.
- No `scripts/`: the repository's npm scripts are the deterministic helpers.

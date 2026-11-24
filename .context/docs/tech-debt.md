---
type: doc
name: tech-debt
description: Known gaps, with the reason they are still open
category: workflow
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

# Technical debt

Known gaps, each with the reason it is still open and the issue that closes it.

| # | Gap | Why it is open | Closed by |
| --- | --- | --- | --- |
| TD-1 | No package exists yet; the unit test project, the coverage include and the `packages` layer rules match nothing | Phase 1 ships the baseline before any domain code | #3 |
| TD-2 | `check:architecture` runs over `scripts` and `eslint-rules` only, and `knip.jsonc` has no `packages/*` workspace | depcruise and knip fail on a path that does not exist | #3 |
| TD-3 | The ruleset's required checks list the CI job names, so renaming a job breaks merging | GitHub matches required checks by name | — (rename with the ruleset) |
| TD-4 | Subscription use through the Agent SDK is undocumented in the security guide | Waiting on the terms check | #5 |

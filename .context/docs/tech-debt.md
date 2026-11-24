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
| TD-5 | Planning an item looks up the open pull request of `agent/issue-N`, a detail of the implement stage, inside the generic `tick()` | It is the only stage so far; with review and merge (#6, #7) each stage will say what "its result is in place" means | #6 |
| TD-7 | `once` acts only with `--dry-run` | The workspace and agent adapters land in #5 | #5 |
| TD-3 | The ruleset's required checks list the CI job names, so renaming a job breaks merging | GitHub matches required checks by name | — (rename with the ruleset) |
| TD-4 | Subscription use through the Agent SDK is undocumented in the security guide | Waiting on the terms check | #5 |

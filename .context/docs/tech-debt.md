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
| TD-9 | `address-feedback` and `refine` stages are not implemented yet; a review with `changes` waits for a person | #6 is split: the review stage first | #6 |
| TD-8 | The implement stage has not run end to end with a real agent on a sandbox repository | It needs an agent credential the development machine does not have (ADR 0004) and a sandbox repository the owner approves | #5 |
| TD-3 | The ruleset's required checks list the CI job names, so renaming a job breaks merging | GitHub matches required checks by name | — (rename with the ruleset) |
| TD-4 | Subscription use through the Agent SDK is undocumented in the security guide | Waiting on the terms check | #5 |

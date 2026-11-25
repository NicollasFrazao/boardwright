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
| TD-12 | `getMergeFacts` reads the first 100 changed files; a larger pull request may hide a denied path | Such a pull request is far over the default `maxChangedLines` (400) and is blocked for size first | — |
| TD-10 | `getFeedback` reads the first 100 review threads and 100 checks of a pull request | More than that is beyond what one round fixes; a person takes over | — |
| TD-8 | The implement stage has not run end to end with a real agent on a sandbox repository | It needs an agent credential the development machine does not have (ADR 0004) and a sandbox repository the owner approves | #5 |
| TD-3 | The ruleset's required checks list the CI job names, so renaming a job breaks merging | GitHub matches required checks by name | — (rename with the ruleset) |
| TD-4 | Subscription use through the Agent SDK is undocumented in the security guide | Waiting on the terms check | #5 |

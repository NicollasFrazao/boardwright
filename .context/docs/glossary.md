---
type: doc
name: glossary
description: Domain vocabulary and the only abbreviations allowed in names
category: domain
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

# Glossary

## Glossary & Domain Concepts

| Term | Meaning |
| --- | --- |
| **board** | A GitHub Project (v2) the pipeline reads; its Status field is the pipeline's state |
| **item** | A card on the board; its content is an issue (pull requests are reached through the issue) |
| **status** | The value of the board's Status field for an item (Todo, Ready, In Progress, In review, Done…) |
| **stage** | A step of the pipeline bound to a status: refine, implement, review, address-feedback, merge, document |
| **tick** | One pass of the reconciliation loop over the board |
| **run** | One execution of a stage on one item, with its own id and worktree |
| **claim** | Taking an item for a run: writing the marker and moving the status |
| **marker** | Hidden comment on the issue recording a run's stage, id, attempt and result |
| **attempt** | The ordinal of a run of the same stage on the same item; limited by `maxAttempts` |
| **trigger** | The label that releases an issue to the pipeline (default `agent`) |
| **provider** | An implementation of `AgentProvider` (Claude first) |
| **playbook** | An agent definition in `.context/agents/*.md` of the target repository |
| **skill** | A procedure in `.context/skills/*/SKILL.md`, selected by PREVC phase |
| **PREVC** | dotcontext's phases: Plan, Review, Execute, Verify (V), Complete |
| **guard rail** | A rule the core enforces on every run, whatever the provider (path denylist, limits, triage) |
| **merge policy** | The deterministic conditions under which the opt-in merge stage enables auto-merge |
| **verdict** | The review stage's outcome (`approve`, `changes`), recorded in its marker |
| **runner** | The CLI/daemon runtime on a machine |
| **gate** | The target repository's own quality checks, run by the agent before pushing |

## Personas

- **Board owner** — decides the statuses, the trigger and whether the merge stage is on.
- **Maintainer** — labels issues for the pipeline (needs triage access) and reviews or merges.
- **Contributor** — opens issues; their text becomes the agent's instructions once a maintainer labels them.

## Allowed abbreviations

`id`, `pr` (pull request, in identifiers only), `mcp`, `sdk`, `ci`, `url`, `api`.

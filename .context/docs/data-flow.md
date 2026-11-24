---
type: doc
name: data-flow
description: An issue from Ready to Done: events, ticks, the run marker, the agent session and the pull request
category: architecture
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

# Data flow

## Data Flow & Integrations

The flow below is the target of phases 3–6. Each arrow is one action of `tick()`.

```
issue labelled `agent` (by someone with triage)
  └─ board: Ready
       └─ tick: claim → marker comment (stage=implement, attempt=1) → Status In Progress
            └─ worktree agent/issue-N → AgentProvider session (playbook + skills of phase E)
                 └─ local gate → diff checked against the path denylist → push → pull request "Closes #N"
                      └─ board: In review (built-in "pull request linked" workflow)
                           ├─ tick: review → comments + verdict in the marker
                           ├─ tick: address-feedback → fix commits (≤ maxAttempts)
                           └─ tick: merge (opt-in) → policy passes → native auto-merge
                                └─ board: Done (built-in "item closed" workflow)
```

## Integrations

| System | Through | Used for |
| --- | --- | --- |
| GitHub Projects v2 | GraphQL (`packages/github`) | Status field and options, items, Track |
| GitHub issues and pull requests | REST/GraphQL (`packages/github`) | Markers, comments, review threads, checks, auto-merge |
| Git | CLI (`WorkspacePort`) | One worktree per run, branch `agent/issue-N` |
| Claude Agent SDK | `packages/agent-claude` | The agent session of a stage |
| dotcontext MCP | `ContextProvider` and the agent session | Playbooks, skills per phase, harness traces and sensors |

## Events and triggers

- **Runner:** polls the board on an interval with backoff; events are not needed.
- **Action:** `issues`, `pull_request`, `pull_request_review`, `check_suite` and `schedule` each run one
  `tick()` scoped to the item the event names, or the whole board on `schedule`.

## Failure handling

- A run that dies leaves its `started` marker; once its timeout plus a 5-minute grace has passed, the
  next tick counts it as an attempt and starts the next one, up to `maxAttempts`, then writes `gave-up`
  and moves the card to the `blocked` Status.
- A failed run goes back to the `when` Status and is retried by the next tick; a blocked or denied run
  goes to the `blocked` Status and waits for a person.
- Two runners that claim the same attempt both write `started`; each re-reads the markers and only the
  earliest claim goes on.
- A push rejected by the ruleset or the path denylist is a failed attempt, never retried with force.

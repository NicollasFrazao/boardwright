# 0001. GitHub is the state store

- Status: accepted
- Date: 2026-11-23

## Context

The pipeline must know, for each board item, which stage ran, which run owns it and how many attempts
were made, across a local runner and the Action, and survive a crash mid-run.

## Options

1. **GitHub only:** the item's Status plus a hidden marker comment on the issue per run.
2. **A database** (SQLite for the runner, a hosted one for the Action).
3. **dotcontext harness state** under `.context/runtime/`.

## Decision

Option 1.

- Both runtimes already read GitHub; no second store can disagree with the board a person sees.
- A database needs hosting for the Action and a sync between runtimes.
- The harness state lives in a worktree that is thrown away after each run, and is gitignored by
  design; it records the run in detail, and its summary goes into the marker.

## Consequences

- Every action of `tick()` must be idempotent and detect its own past effects on GitHub.
- The marker format is a public contract between runner versions.
- Reading state costs API calls; the runner polls with backoff and the Action scopes a tick to the
  item the event names.

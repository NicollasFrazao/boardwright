# 0002. One core, two runtimes; credentials are never stored

- Status: accepted; the credentials part is amended by [0004](./0004-agent-credentials-through-documented-methods.md)
- Date: 2026-11-23

## Context

Agents need credentials. A subscription login works on the machine where it was made but should not be
copied into CI; teams with an API key prefer to run everything in GitHub Actions.

## Options

1. **Action only**, with an API key as a secret.
2. **Runner only**, on a machine or server.
3. **One core with two runtimes:** a local runner (CLI/daemon) and an Action, both running the same `tick()`.

## Decision

Option 3.

- The runner uses the agent login already on the machine, or `ANTHROPIC_API_KEY`; boardwright never
  reads, copies or refreshes a credential.
- The Action uses an API key from a repository secret.
- The layer rules make the runtimes thin composition roots, so behaviour cannot drift between them.

## Consequences

- Whether a subscription may be used through the Agent SDK in a third-party tool is the user's call
  under the current terms; the docs recommend an API key for anything shared (#5).
- The runner defaults to one concurrent run, since agents are memory-heavy on small machines.

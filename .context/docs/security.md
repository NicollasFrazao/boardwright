---
type: doc
name: security
description: Threat model, tokens and credentials, the trigger and guard rails, known gaps, how to report a vulnerability
category: security
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---

# Security

## Security & Compliance Notes

boardwright gives an agent write access to repositories. The security model is that the agent can do
no more than its stage allows, whatever the issue text says, and that the people who can start it are
the people who could have made the change themselves.

## Threat model

| Threat | Control |
| --- | --- |
| A stranger's issue steers an agent | The trigger label counts only when added by someone with triage access |
| Prompt injection asks the agent to edit CI or exfiltrate secrets | Path denylist (`.github/workflows/**`, secret files) in the session and on the diff; tokens never in the agent environment beyond what the stage needs |
| An agent merges unreviewed code | No merge outside the opt-in merge stage; its policy is deterministic code, and auto-merge still passes the ruleset |
| A token with bypass rights skips the ruleset | Tokens need no bypass; the docs require tokens without it |
| Runaway cost or loops | `maxTurns`, timeout and `maxAttempts` per stage; one run per item |
| Two runners act on the same item | The claim marker and idempotent actions |

## Authentication & Authorization

- **Board token:** classic token with the `project` scope (user projects are not reachable with the
  default `GITHUB_TOKEN`). The CLI reads it from `BOARDWRIGHT_GITHUB_TOKEN`, `GITHUB_TOKEN` or
  `GH_TOKEN`, in that order, and hands it only to the Octokit client, whose request log is silenced.
- **Who released an issue:** the most recent person who added the trigger label, read from the issue's
  events, with their role from the collaborator permission API. A bot or a non-collaborator has no
  permission, so it can never start an agent.
- **Repository token:** fine-grained, contents/pull requests/issues read-write on the allowlisted
  repositories; pull requests opened with the default token do not trigger CI.
- **Merge token (opt-in):** separate from the token that opened the pull request.
- **Agent credentials:** only the Agent SDK's documented methods (`ANTHROPIC_API_KEY`, Bedrock, Claude
  Platform on AWS, Google Cloud, Foundry), never a claude.ai login, and never stored or managed by
  boardwright. See [ADR 0004](./adr/0004-agent-credentials-through-documented-methods.md).

## What an agent session can do

The Claude provider (`packages/agent-claude/src/claude-provider.ts`) starts every session with:

- `permissionMode: 'dontAsk'` and a closed list of tools (`Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash`,
  `TodoWrite`, plus dotcontext's read tools when the repository has a `.context` base); everything else is
  denied, and `WebFetch`, `WebSearch` and dotcontext's `sync` are denied even if the repository's settings
  allow them;
- a `PreToolUse` hook that denies writes to a denied path or outside the worktree, and shell commands that
  push or call `gh`;
- the environment without `BOARDWRIGHT_GITHUB_TOKEN`, `GITHUB_TOKEN` and `GH_TOKEN`;
- only the project's settings (`settingSources: ['project']`), not the machine user's;
- for a review, read tools only (`Read`, `Glob`, `Grep`, `Bash`) with `Edit`, `Write`, `MultiEdit` and
  `NotebookEdit` denied; its worktree is thrown away and nothing is pushed. Its review only comments; it
  never approves.
- for address-feedback, the review comments and check names are fenced as input like the issue, and
  only the core resolves threads: the agent names the ones it addressed, and the core resolves those
  that were in the feedback it read.

The git workspaces give the token to the runner's own `clone`, `fetch` and `push` through the commands'
`GIT_CONFIG_*` environment; it is never written to `.git/config`, so the agent cannot read it, and its own
`git push` has no credentials. The core still checks the diff against the denylist before pushing.

## Secrets & Sensitive Data

Tokens are read only in the composition roots, never logged, never written to a marker, comment,
artifact or dotcontext harness trace. Logs are JSON and redact any value read from a secret.

## Known gaps

- The issue text is untrusted input to a model; the controls above limit what it can cause, not what
  it can say. Labelling an issue is a trust decision.
- Subscription use through the Agent SDK in third-party tools: the current terms are checked in #5
  and the result recorded here.

## Incident Response

Report vulnerabilities privately through
[private vulnerability reporting](https://github.com/NicollasFrazao/boardwright/security/advisories/new);
see `SECURITY.md` for scope.

# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub's
[private vulnerability reporting](https://github.com/NicollasFrazao/boardwright/security/advisories/new)
with:

- what an attacker can do (for example: make an agent run on an issue from someone without triage
  access, get an agent to change `.github/workflows`, merge a pull request the merge policy should
  block, read a token from a run's logs);
- the config, the board state and the events that reproduce it;
- the commit you tested.

You can expect an acknowledgement within a week. Fixes are released on `master` and credited in the
advisory unless you prefer otherwise.

## Supported versions

Only the latest commit on `master` is supported until the first release.

## Scope

In scope: the trigger checks (allowlist, triage), the guard rails (path denylist, turn and attempt
limits), the merge policy, the handling of tokens and credentials, and anything that lets an agent
act outside the stage it was started for.

Known and out of scope: an issue's text becomes the agent's instructions. Whoever labels an issue for
the pipeline is trusted to have read it; the triage check exists so that only those people can.

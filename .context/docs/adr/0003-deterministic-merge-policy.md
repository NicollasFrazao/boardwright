# 0003. Agentic merge is opt-in and decided by deterministic code

- Status: accepted
- Date: 2026-11-23

## Context

Merging is the step with the largest blast radius. Some teams want agents to merge low-risk changes;
others never will.

## Options

1. **Never merge.**
2. **Let the reviewing agent decide.**
3. **A deterministic policy in the core**, off by default, that enables GitHub's native auto-merge
   when every condition holds; optionally a gatekeeper agent that can veto.

## Decision

Option 3.

- The conditions (required checks green, zero unresolved threads counted again right before merging,
  the review verdict, a clean feedback loop, a changed-lines limit, a path denylist, opt-in and
  opt-out labels with `needs-human` always winning) are code with table tests, the same for every
  provider.
- Native auto-merge completes only when the ruleset's checks pass, so nothing bypasses the ruleset.
- A model can veto a merge in `mode: agent`; it can never force one.

## Consequences

- The merge stage is off until a board owner turns it on per repository.
- Every agentic merge leaves a comment with the policy evaluation, as the audit trail.
- A separate merge token keeps "who opened" and "who merged" distinct.

---
type: skill
name: Security Audit
description: Review code and infrastructure for security weaknesses. Use when Reviewing code for security vulnerabilities, Assessing authentication/authorization, or Checking for OWASP top 10 issues
skillSlug: security-audit
phases: [R, V]
generated: 2026-11-24
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

1. Map the change to the threat model in `.context/docs/security.md`.
2. Try hostile issue text against each affected control (trigger, path denylist, limits).
3. Check token handling: read only in composition roots, never logged or written to GitHub or a harness trace.
4. Check the merge policy cannot be satisfied by an agent's own output alone.
5. Report findings with severity; update `security.md` when a gap opens or closes.

## Examples

```
Finding (high): the path denylist is checked only in the agent session; a provider
without hooks bypasses it. Check the diff again in the core before pushing.
```

## Quality Bar

- Assume the issue text is hostile.
- A control in the core beats one in a provider.
- A new tool in an agent session needs a reason and a limit.

## Resource Strategy

- Keep the procedure in this file; it is short enough to read on every run.
- Add `references/` only for a checklist too long to keep here, and link it from the workflow step that needs it.
- No `scripts/`: the repository's npm scripts are the deterministic helpers.

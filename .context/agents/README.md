# Agent Handbook

This directory contains ready-to-customize playbooks for AI agents collaborating on the repository.

## Available Agents

Each playbook is a role the pipeline runs, mapped to its stage and PREVC phase:

| Agent | Stage | Phases |
| --- | --- | --- |
| [Architect Specialist](./architect-specialist.md) | refine | P, R |
| [Feature Developer](./feature-developer.md) | implement (features) | P, E |
| [Bug Fixer](./bug-fixer.md) | implement (defects) | E, V |
| [Test Writer](./test-writer.md) | implement, address-feedback | E, V |
| [Code Reviewer](./code-reviewer.md) | review | R, V |
| [Security Auditor](./security-auditor.md) | review of guard rails, tokens and the merge policy | R, V |
| [Documentation Writer](./documentation-writer.md) | document | P, C |
| [Devops Specialist](./devops-specialist.md) | CI, repository settings, the Action | E, C |

## How To Use These Playbooks
1. Pick the agent whose stage matches the task, or let the pipeline pick it by phase (`agent` `orchestrate` in the dotcontext MCP).
2. Read the playbook's skills before starting; they hold the procedures.
3. Follow its collaboration checklist and leave the hand-off notes it asks for.
4. Capture learnings in the relevant guide under `../docs/` so future runs improve.

## Related Resources
- [Documentation Index](../docs/README.md)
- [Agent Knowledge Base](../../AGENTS.md)
- [Contributor Guidelines](../../CONTRIBUTING.md)

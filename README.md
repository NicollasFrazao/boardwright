# boardwright

Agentic delivery pipelines driven by GitHub Projects. Each Status column of your board maps to an
agent role — refine, implement, review, address feedback, and optionally merge and document — and
boardwright moves cards through that flow the way a person would: on a branch, through a pull request,
under your rulesets and required checks.

> **Status: in development.** Nothing is released yet. The roadmap is
> [issue #1](https://github.com/NicollasFrazao/boardwright/issues/1), one sub-issue per phase.

## How it works

- **The board is the source of truth.** A config file maps statuses to stages; a reconciliation loop
  reads the board, claims an item, runs the stage's agent in its own git worktree, and moves the card.
  State lives on GitHub (the Status plus a run marker comment), so there is no database.
- **Two runtimes, one core.** A local runner (CLI/daemon) that uses the agent login already on your
  machine, and a GitHub Action for API-key setups.
- **Your repository's context decides the agent.** Playbooks and skills come from the repository's
  [dotcontext](https://github.com/vinilana/dotcontext) base (`.context/agents`, `.context/skills`),
  selected by PREVC phase; repositories without one fall back to `AGENTS.md`/`CLAUDE.md`.
- **Claude first, providers pluggable** behind an `AgentProvider` interface.
- **Merging is human by default.** Agentic merge is an opt-in stage decided by a deterministic policy
  (required checks, unresolved threads, review verdict, path denylist, size), through native
  auto-merge, never by bypassing the ruleset.

## Try it

Nothing is published yet; from a clone, with Node 26 (the active LTS):

```bash
npm ci
export GITHUB_TOKEN=$(gh auth token)   # a token that can read your board (project scope) and repositories
npm run boardwright -- init --owner <login> --project <number> --repository <owner/name>
npm run boardwright -- doctor          # checks the config against the board; changes nothing
npm run boardwright -- once --dry-run  # prints what one tick would do; changes nothing
npm run boardwright -- once            # runs the due stages: needs ANTHROPIC_API_KEY (or another documented method)
```

The agent authenticates only through the [Claude Agent SDK's documented methods](https://code.claude.com/docs/en/agent-sdk/quickstart):
an API key, Amazon Bedrock, Claude Platform on AWS, Google Cloud or Microsoft Foundry. boardwright never
offers or handles a claude.ai login.

## Safety model

An agent can do no more than its stage allows: no push to the base branch, no force-push, no changes
to `.github/workflows`, turn/time/attempt limits per stage, and only people with triage access can
release an issue to the pipeline. See [`.context/docs/security.md`](.context/docs/security.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents start at [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

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
- **Two runtimes, one core.** A local runner (CLI/daemon) and a GitHub Action, both running the same
  tick and authenticating the agent the same way.
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
npm run boardwright -- run             # keeps ticking until Ctrl+C
```

The agent authenticates only through the [Claude Agent SDK's documented methods](https://code.claude.com/docs/en/agent-sdk/quickstart):
an API key, Amazon Bedrock, Claude Platform on AWS, Google Cloud or Microsoft Foundry. boardwright never
offers or handles a claude.ai login.

## GitHub Action

The Action runs one tick per workflow run, the same `tick()` as `once`. Every tick reads the whole
board, so the events only decide *when* it looks; a missed event is caught by the next one or by the
schedule.

```yaml
name: boardwright

on:
  issues:
    types: [labeled]
  pull_request_review:
  check_suite:
    types: [completed]
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

# One tick at a time; a queued run is enough, since the next tick sees everything that happened.
concurrency:
  group: boardwright
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  tick:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v7          # the repository that holds pipeline.config.yml
      - uses: NicollasFrazao/boardwright@<commit sha>
        with:
          github-token: ${{ secrets.BOARDWRIGHT_GITHUB_TOKEN }}
          # merge-token: ${{ secrets.BOARDWRIGHT_MERGE_TOKEN }}  # only with a merge stage
          # dry-run: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

| Input | Default | |
| --- | --- | --- |
| `github-token` | — (required) | Reads the board and writes to the repositories. A user's Project needs a classic token with the `project` scope; the job's `GITHUB_TOKEN` cannot read it. |
| `merge-token` | `''` | The merge stage's token, an identity other than the one that opens pull requests. |
| `config` | `pipeline.config.yml` | The config, relative to the workspace. |
| `dry-run` | `false` | Print what the tick would do and change nothing. |

The agent's credentials go on the step's `env`, never as inputs: `ANTHROPIC_API_KEY` or a cloud
provider's variables. The Action runs on `node24`; on its first run in a job it downloads the Claude
Agent SDK and its native binary from npm, at the versions `package-lock.json` pins, and refuses any
tarball whose hash differs from the lockfile's.

## Safety model

An agent can do no more than its stage allows: no push to the base branch, no force-push, no changes
to `.github/workflows`, turn/time/attempt limits per stage, and only people with triage access can
release an issue to the pipeline. See [`.context/docs/security.md`](.context/docs/security.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents start at [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

# Contributing

Thanks for taking the time. boardwright lets agents act on real repositories, so the bar is that no
agent ever does more than its stage allows, that every action is safe to repeat, and code a reviewer
can read in one sitting.

The full rules are in [`.context/docs/development-conventions.md`](.context/docs/development-conventions.md).
This page is the short version.

## Setup

```bash
npm ci    # installs dependencies and the git hooks
```

No GitHub token and no agent credentials are needed to develop: the core is tested with fake ports.
Running the pipeline against a real board needs both (see the README once the runner lands).

## Branches

Branch from `master`, named by the kind of change:

| Prefix | For |
| --- | --- |
| `feat/` | a new capability |
| `fix/` | a defect |
| `docs/` | documentation only |
| `refactor/` | a structural change with no behaviour change |
| `chore/` | maintenance, dependencies |
| `test/` | tests only |
| `ci/` | workflows |

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint in the
`commit-msg` hook and, in CI, on every commit of a pull request:

```
fix(core): claim a board item only once per stage

Two runners that read the board in the same second both moved the item to
In Progress and started an agent. The claim now writes the run marker
first and backs off when another marker for the same stage is newer.

Closes #12
```

**The commit type is the version**: `feat` → minor; `fix`, `perf`, `refactor` → patch; `!` after the
type or a `BREAKING CHANGE:` footer → major; `docs`, `test`, `build`, `ci`, `chore`, `style` → no
release. Use `!` only when an existing config file, a run marker or a provider integration breaks.

## Before pushing: the local gate

Run these one at a time:

```bash
npm run lint                # ESLint, any warning fails
npm run typecheck
npm run check:architecture  # layer rules
npm run check:unused        # unused files, exports, dependencies
npm run test:coverage       # all tests, 80% coverage on all four metrics
npm run check:context       # agent surfaces in sync with .context/docs/README.md
npm run build:action        # rebuilds the Action's dist/; commit it whenever it changed
```

They are the CI jobs. If they pass locally and `dist/` is committed as `build:action` left it, CI passes.

## Pull requests

- Small, one concern each. A refactor and a behaviour change are two pull requests.
- Fill in the template. Verification states **results** ("95/95 tests, coverage 99/91/96/99"),
  not "tested".
- Link the issue with an English closing keyword: `Closes #12`. Other words do not link.
- A change to a stage rule, a guard rail or the merge policy needs a test that fails without the change.

## Language

Code, comments, docs, commits, issues and pull requests are in English.

## Repository settings (maintainers)

On GitHub:

- **Branch ruleset on `master`**: require a pull request; require the status checks `lint`,
  `typecheck`, `architecture`, `unused`, `test`, `audit`, `context`, `commitlint` and `CodeQL`;
  block force pushes; require linear history.
- **Code security**: enable secret scanning, push protection, Dependabot alerts and private
  vulnerability reporting (used by [SECURITY.md](SECURITY.md)).

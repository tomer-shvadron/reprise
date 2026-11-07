# Contributing to Reprise

Reprise is built issue by issue, mostly by agents, with every PR reviewed by an agent and merged by the lead. This file is the working agreement. The reasoning behind it is in [ADR-0014](docs/decisions/0014-repo-and-process.md) and [ADR-0016](docs/decisions/0016-build-order-and-parallel-lanes.md); the plan it serves is [the roadmap](docs/plans/roadmap.md).

## From plan to issue

Every unit of work is a GitHub issue first. Each work package in a phase plan under [`docs/plans/`](docs/plans/) becomes one issue, filed from the **Work package** template:

- Title `WP-0NN: <title>`.
- Labels `area:<package>`, `type:<feature|chore|test|contract|bug>`, `phase:<0-4>` and `lane:<score|audio|formats|app|lead>`.
- The milestone of the checkpoint it feeds, and the **Reprise** project board, starting in Backlog.
- A body with the work package verbatim, the briefing list, "Blocked by #n" lines and the rules for the issue.

The plan records intent; the issue records progress. When the two disagree, update the plan in the PR that resolves the disagreement. Bugs use the **Bug** template. Issues are filed phase by phase, so the backlog only describes contracts that exist.

`scripts/github/bootstrap.sh` creates or updates the labels, milestones and board. It is idempotent and never deletes anything; `DRY_RUN=1` prints what it would change.

## Briefing order

An agent picking up an issue reads, in this order:

1. [`docs/specs/shared-understanding.md`](docs/specs/shared-understanding.md)
2. [`docs/specs/architecture.md`](docs/specs/architecture.md)
3. The ADRs the issue links
4. The work package in the phase plan
5. The reference notes for its area under [`docs/reference/`](docs/reference/)

The issue body says which of these apply.

## Lane rules

From [the roadmap](docs/plans/roadmap.md#lane-rules):

1. A lane touches only its package, its feature folder, and their tests. Fixtures and docs for its area are fine.
2. A lane never edits `packages/model` or `apps/web/src/state`. If it needs a contract change, it opens an issue labelled `type:contract` and the lead resolves it as its own PR before the lane continues.
3. A lane works in its own git worktree on a branch named `wp-0NN-short-slug` and opens one PR per work package.
4. A PR's description states what was verified and how, links its issue, and includes measurements for anything the budgets table covers.
5. Integration PRs are lead-only and are where lanes first meet. A lane does not wire its output into the app shell; it exposes the contract and ships a demo route or a story under its feature folder instead.

The roadmap's rule 6, review before merge, is the review flow in [AGENTS.md](AGENTS.md#task-workflow).

## Branches and commits

- One branch per work package, named `wp-0NN-short-slug` after the issue (`wp-005-repository-governance`), off `main`, in its own worktree.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, imperative and lowercase, for example `feat(formats): read gp5 voltas` or `chore(repo): add issue templates`. The scope is the package or area; leave it out for a change that is genuinely cross-cutting.
- No samples, tabs, secrets or build output in git. Downloaded tabs for manual testing go in `local-tabs/`, which is ignored.
- The owner has approved branch commits, pushes and PR creation for the whole project (ADR-0019): an agent working an issue commits on its own branch and opens its PR without asking. `main` changes only through reviewed, CI-green squash merges performed by the lead.

## Pre-commit hook

`pnpm install` installs a Husky pre-commit hook (the `prepare` script; the hook is `.husky/pre-commit`, its tasks are in `lint-staged.config.js`). While it runs, lint-staged (`--hide-all`) stashes unstaged changes and untracked files, so every check sees exactly what is being committed: a file you forgot to `git add` fails the commit, and unstaged work in progress cannot fail it. If a run is interrupted, everything, untracked files included, is in the `lint-staged automatic backup` stash. On every commit it runs:

- `scripts/conflicts/check.ts` on every staged file, before ESLint or Prettier can rewrite it. It fails on git's conflict markers (seven `<`, `=`, `>` or `|` at the start of a line, then a space or the end of the line) in any text file, including the ones Prettier never formats (shell scripts, snapshots, dotfiles, everything under `docs/`). It also fails on the forms Prettier leaves once it has rewritten them, which `format:check` accepts: in Markdown, a marker inside a table row, a list item or a quote, an escaped `\=======`, a `>>>>>>>` respaced into seven nested quotes; in HTML, a marker indented or joined onto one line. A file that must hold such text goes in `ALLOWED` in that script, with its reason. `pnpm conflicts:check` runs the same check over every tracked file, as CI does. Because a setext underline of exactly seven `=` counts as a marker, Markdown headings use the ATX form (`#`). Fenced code is not exempt either, indented or not: write an example marker with six characters rather than allow-listing the file, since `ALLOWED` turns the check off for the whole file.
- ESLint (`--fix --max-warnings 0`) and then Prettier on staged code, Prettier on staged JSON, Markdown, YAML, CSS and HTML. A problem the tool can fix is fixed and the fix is staged with the commit; anything else rejects the commit.
- `vitest related --run` on the staged TypeScript: every test that imports those files, directly or through other modules, in every Vitest project except the browser-mode `audio` project, which joins only when a file under `packages/audio` is staged (every audio test imports the model, so a model-only commit would otherwise launch Chromium).
- `tsc -b`, incremental, on every commit, including one that only deletes files.

Bench files (`*.bench.ts`) never run here: `pnpm bench` runs them, and CI runs it after the tests.

Measured: a docs-only commit about one second, a one-file change in `packages/model` about five seconds (it rebuilds the downstream types and runs every test that imports the model), a one-file `packages/audio` change about three. If the hook takes much longer, something is wrong; say so on the issue rather than skipping it.

The hook is per worktree: Husky writes its shim under `.husky/_/` (ignored), and git skips a missing hook without a word, so **run `pnpm install` in every new worktree before committing**. A git GUI that starts with a minimal `PATH` may not find `node`; put your Node install on the `PATH` in `~/.config/husky/init.sh`, which the hook sources.

`git commit --no-verify` skips the hook (`HUSKY=0` skips it for a whole shell). Use it only when the hook itself is what is broken and the fix is the commit you are making, and say so in the PR. CI runs the full lint, typecheck, test, format and conflict-marker checks regardless, so skipping the hook only moves a failure from your machine to the PR, where it costs a review round trip.

## Pull requests

- One PR per work package, filled from the PR template, squash-merged into `main`. The PR title becomes the squash commit, so it is a conventional commit line too.
- The body links the issue (`Closes #n`), says what changed and **how it was verified**: the commands run and what they showed, not just "tests pass".
- Include the `pnpm bench` table before and after for anything the [budgets table](docs/plans/roadmap.md#budgets) covers, screenshots for any UI change, and any deviation from the plan with its reason.
- Open questions go on the issue as comments, not as assumptions buried in code.
- Before opening it, this passes locally, and CI must be green on the PR (lint, typecheck, tests, build, per [ADR-0014](docs/decisions/0014-repo-and-process.md)):

  ```sh
  pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
  ```

- An agent reviews the PR and another fixes the findings on the same branch, as [AGENTS.md](AGENTS.md#task-workflow) describes; the lead merges after the review, once CI is green.

## No time estimates

Work packages carry a size by scope, never by time: **S** a focused change in one file or module, **M** a module with tests, **L** a subsystem with several modules and a test suite, **XL** should have been split, and is only used when splitting would create artificial seams. Do not add days, weeks or deadlines to docs, issues or code. Agents do the implementation; the time that matters goes to planning and review.

## Git and gh credentials

The owner's machine has more than one GitHub account. The repository's local git config pushes as the personal account (`tomer-shvadron`) through a credential helper, so `git push` needs nothing extra. The `gh` CLI does not read that config: when its active account is a different one, prefix each command with the personal token:

```sh
GH_TOKEN=$(gh auth token --user tomer-shvadron) gh pr create -R tomer-shvadron/reprise ...
```

The bootstrap script needs the `project` scope for the board. Without it, the script skips the board and prints the command that grants it:

```sh
gh auth refresh -s project,read:project
```

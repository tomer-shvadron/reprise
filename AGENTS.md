# Reprise: agent instructions

Reprise is a Guitar Pro style tab player, trainer and editor for the desktop: it opens gp3, gp4, gp5, gpx and gp files, renders them as tab or standard notation, plays them back with sampled instruments and lets you edit them. It is a pnpm monorepo of framework-free engine packages under `packages/` and a React web core wrapped by Electron under `apps/`. It is built issue by issue, mostly by agents; [README.md](README.md) is the quick start and [docs/README.md](docs/README.md) maps the documentation and the briefing order.

**This file is the source of truth for agent instructions.** `CLAUDE.md` beside it is the single line `@AGENTS.md`, because Claude Code reads `CLAUDE.md` and other agents read `AGENTS.md`. Edit this file; never give `CLAUDE.md` content of its own.

Where things are decided, rather than repeated here:

- [CONTRIBUTING.md](CONTRIBUTING.md): issues, labels, briefing order, lane rules, branch names, commits and PRs.
- [docs/specs/](docs/specs/): the shared understanding, the v1 scope and the architecture, the frozen contracts.
- [docs/decisions/](docs/decisions/README.md): the ADRs, append-only.
- [docs/plans/](docs/plans/roadmap.md): the roadmap, the lane rules, the budgets and the work packages per phase.

## Task workflow

The rule, in the owner's words:

> Whenever the owner gives a coding task: 1) create a GitHub issue for it; 2) plan the implementation with an Opus sub-agent at xhigh effort, posting the plan on the issue; 3) implement the plan with an Opus sub-agent at medium effort that commits, pushes and opens the PR; 4) review the PR with an Opus sub-agent at xhigh effort that posts findings as PR review comments; 5) fix the review comments with an Opus sub-agent at medium effort. The lead merges after CI is green.

Amended on 2026-11-06 from Fable to Opus at xhigh effort, when the Fable monthly limit ran out; Fable is not used unless the owner says so ([ADR-0020](docs/decisions/0020-plan-and-review-with-opus-at-xhigh-effort.md)).

The lead's ruling on PR #84, which the owner can overrule: a coding task is any change to code, tests, configuration, scripts or the build, and gets all five steps. A change that touches only Markdown files skips the plan step (step 2) and keeps implement, review and fix.

"The lead" is the Claude session the owner talks to. Around the rule:

- Issues map to the work packages in [docs/plans/](docs/plans/), one issue per work package, filed as [CONTRIBUTING.md](CONTRIBUTING.md#from-plan-to-issue) describes.
- Every PR is reviewed at xhigh effort, above the medium effort it was written at ([ADR-0020](docs/decisions/0020-plan-and-review-with-opus-at-xhigh-effort.md)).
- Review (step 4): the reviewer changes nothing on the branch. It posts its findings as one PR review with inline comments tagged `[blocker]`, `[should]` or `[nit]`, and a summary.
- Fix (step 5): the fixer commits on the PR branch in small commits, answers each review thread with what it did or why not, and reports back.
- The lead merges when every `[blocker]` and `[should]` is resolved and CI is green, with `gh pr merge --squash --auto --delete-branch`. The squash subject is `<PR title> (#N)`; the body is a short summary plus one `Co-Authored-By` line per distinct model that wrote commits on the branch (today only Opus) and the `Claude-Session` line. `main` changes no other way.
- The lead moves the issue's item on the **Reprise** board: Backlog, Ready, In progress, In review, Done.
- A stacked branch is brought up to date by merging `origin/main` into it, never by rebasing.
- Branches are deleted at merge time, which closes every PR stacked on the base. Retarget stacked PRs to `main` before the base PR is merged. A PR closed that way is reopened before anything is pushed to its head (GitHub refuses to reopen a PR whose head moved), and otherwise recreated.

## Permissions and git

- The owner has approved branch commits, pushes and PR creation for the whole project ([CONTRIBUTING.md](CONTRIBUTING.md#branches-and-commits), ADR-0019). Do them without asking.
- Never commit to `main`. Never rebase, `reset --hard`, amend a pushed commit or force-push.
- Never skip the pre-commit hook (`--no-verify`, `HUSKY=0`) except as [CONTRIBUTING.md](CONTRIBUTING.md#pre-commit-hook) allows.
- Each branch gets its own worktree under `../reprise-worktrees/<branch>`; run `pnpm install` in it before the first commit, or the pre-commit hook is skipped without a word.
- Commits carry the identity `Tomer Shvadron <tomer94@gmail.com>` from the repository-local git config; do not override it.
- End a commit written by an agent with a co-author trailer naming the model that wrote the change, and with the `Claude-Session:` line when the session provides one:

  ```text
  Co-Authored-By: Claude {model} <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_...
  ```

  Keep exactly one `<...>` group on the trailer line: git reads the first one as the email, so a bracketed placeholder breaks the attribution.

## GitHub

The repository lives on the owner's personal account (`tomer-shvadron/reprise`), while the `gh` CLI is normally logged into a work account. `git push` already works through the repo-local credential helper; `gh` does not read it. Run this before `gh` commands, and never `gh auth switch`:

```sh
export GH_TOKEN="$(gh auth token --user tomer-shvadron)"
```

Labels, milestones and the **Reprise** project board come from `scripts/github/bootstrap.sh` (idempotent, `DRY_RUN=1` to preview). `scripts/github/protect-main.sh` applies the merge settings and the branch protection on `main`, which requires the CI check named `ci`.

## Layout and boundaries

| Workspace          | Package            | What it is                                                              |
| ------------------ | ------------------ | ----------------------------------------------------------------------- |
| `packages/model`   | `@reprise/model`   | Score data model, IDs, timing, commands, history and the native format. |
| `packages/formats` | `@reprise/formats` | gp3/gp4/gp5, gp and gpx readers, the gp writer, format detection.       |
| `packages/layout`  | `@reprise/layout`  | Score to positioned glyphs plus hit-testing geometry.                   |
| `packages/audio`   | `@reprise/audio`   | Sampler, scheduler, SF2/SFZ loaders, effects, memory manager.           |
| `apps/web`         | `@reprise/web`     | The React app: painter, transport, library, trainer, editor UI.         |
| `apps/desktop`     | `@reprise/desktop` | Electron main and preload, the platform adapter, packaging.             |

The allowed dependency edges and the feature folders under `apps/web/src/features/` are in [docs/specs/architecture.md](docs/specs/architecture.md). `pnpm lint` enforces the boundaries, and [eslint.config.js](eslint.config.js) is the exact rule set:

- Packages under `packages/` are framework-free: no `react`, `react-dom`, `@radix-ui/*`, `zustand` or `dexie`.
- The engines `formats`, `layout` and `audio` never import each other; a shared helper lives in `model`. `model` imports no workspace package, and `desktop` imports `web` for types only.
- A package is imported only through its root export (`@reprise/x`), and the ban covers dynamic `import()` calls too.
- `electron` is imported only inside `apps/desktop`.
- `@reprise/model/testing`, the one allowed subpath, is imported only from test files.
- `@coderline/alphatab`, the dev-only oracle, is imported only under `packages/formats/test/**` and `scripts/**`.

## Commands

From the repository root, after `pnpm install` (Node 24, pnpm 11):

```sh
pnpm lint                  # ESLint with the boundary rules, --max-warnings 0
pnpm typecheck             # tsc -b across every workspace
pnpm test                  # Vitest, every workspace as its own project
pnpm format:check          # Prettier check; pnpm format writes
pnpm dev                   # the web app on the Vite dev server
pnpm build                 # production build of the web app
pnpm desktop:dev           # the Electron app around the web core
pnpm desktop:build         # electron-vite build plus electron-builder installers
pnpm fixtures:check        # re-describes fixtures/ with alphaTab, fails on a stale manifest
pnpm sounds:fetch          # downloads the GM soundfont, verified by SHA-256
pnpm layout:metrics:check  # fails when the committed layout font metrics are stale
```

The PR gate is `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`; CI also runs `pnpm fixtures:check` and `pnpm build` ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Testing

Vitest, one project per workspace, defined in [vitest.config.ts](vitest.config.ts): `model`, `formats`, `layout`, `audio-node`, `desktop` and `scripts` run in node, `web` in jsdom, and `audio` in browser mode on the Playwright Chromium headless shell. `pnpm install` downloads the shell locally; in CI the install skips it and a later step installs it without `--with-deps` (#75), so a new browser-mode test needs no workflow change. `audio-node` runs the audio package's `*.node.test.ts` files in plain Node, proving the SF2 parser and the signal measurements stay DOM-free.

- Build scores in tests with the builders from `@reprise/model/testing` (`score`, `note`, `ScoreBuilder`, `fullScore`, `largeScore`, `beatOf`, `noteOf`), not by hand.
- The format readers are checked against alphaTab by the oracle under `packages/formats/test/oracle/`.
- Automated tests use only the open-licensed corpus in `fixtures/` ([LICENSES.md](fixtures/LICENSES.md), `manifest.json`). `local-tabs/` holds downloaded tabs for manual testing and is never committed; a bug a local tab exposes is reproduced in a licensable fixture before it gets a test.
- The GeneralUser GS soundfont is fetched by hash with `pnpm sounds:fetch` (pins in `scripts/sounds/gm.json`) into `apps/web/public/sounds/gm/`, and never committed.
- Performance budgets live in the [budgets table](docs/plans/roadmap.md#budgets); a PR touching them reports before and after measurements.

## Conventions

[CONTRIBUTING.md](CONTRIBUTING.md) and the Conventions section of [docs/specs/architecture.md](docs/specs/architecture.md) govern. In short, plus what they leave implicit:

- Comments explain why, not what.
- Source filenames are kebab-case (`unicorn/filename-case`).
- No `any`, no `as` casts without a structural reason; `noUncheckedIndexedAccess` is on.
- Zod schemas are the source of the model's types: declare the schema and derive the type with `z.infer`.
- Diagnostic identifiers (`rule`, `code`) are kebab-case; model enum values stay camelCase.
- Plans carry sizes by scope (S, M, L, XL), never time estimates.
- Documentation lives under `docs/`, in the subdirectory for its type (`specs`, `decisions`, `plans`, `reference`, `research`). Prettier ignores `docs/`.

## Quota

Running many heavy sub-agents at once (nine review agents in parallel) exhausted the account's 5-hour limit twice. Stagger reviews rather than launching them together. After a 429, resume each stopped agent by sending it a message, which continues its transcript, instead of restarting it, and check each worktree's `git status` first so no work is redone or lost. When a model's limit is exhausted outright rather than for five hours, stopped agents cannot be resumed on it: brief fresh agents, on the workflow's model, on the PR, its comments and the worktree's `git status` instead.

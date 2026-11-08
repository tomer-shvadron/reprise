# Reprise

A Guitar Pro style tab player, trainer and editor for the desktop. Built so one person can play guitar again.

Reprise opens Guitar Pro files (gp3, gp4, gp5, gpx, gp), renders them as tab with rhythm notation or standard notation, plays them back with sampled instruments at any tempo, loops sections for practice, and lets you write and edit tabs. It runs as an Electron app on macOS, with Windows builds in CI.

Status: **foundation in progress.** See `docs/plans/roadmap.md` for what comes next.

## Documentation

Everything about what Reprise is and why it is built the way it is lives under [`docs/`](docs/README.md):

- [Shared understanding](docs/specs/shared-understanding.md): the agreed baseline.
- [Scope for v1](docs/specs/scope-v1.md): what is in, deferred and dropped.
- [Architecture](docs/specs/architecture.md): packages, boundaries and contracts.
- [Decisions](docs/decisions/README.md): one record per decision.
- [Roadmap](docs/plans/roadmap.md): phases, lanes, sequential and parallel work.
- [Contributing](CONTRIBUTING.md): from plan to issue to PR, the briefing order, lane rules, branch names and commit conventions.

## Prerequisites

- Node 24 (see `.nvmrc`)
- pnpm 11

## Commands

Run from the repository root. On a fresh clone start with `pnpm bootstrap`: it checks Node and pnpm, runs `pnpm install`, makes sure the Chromium headless shell and the GM soundfont are in place, and prints the next commands. It is safe to re-run. (Not `pnpm setup`, which is a pnpm built-in that edits your shell profile.)

```
pnpm bootstrap      # first step on a fresh checkout; idempotent
```

```
pnpm lint           # ESLint, including the package boundary rules; fails on any warning
pnpm typecheck      # tsc -b across every package, incremental
pnpm test           # Vitest, every package as its own project
pnpm test:watch
pnpm format         # Prettier; format:check verifies without writing
pnpm bench          # the roadmap's budgets, measured one file at a time
pnpm dev            # the web app in the browser, Vite dev server with hot reload
pnpm build          # production build of the web app into apps/web/dist
pnpm desktop:dev    # the Electron app around the same web core, with hot reload
pnpm desktop:build  # fetches the GM sound bank, electron-vite build, then electron-builder for the current platform
pnpm desktop:smoke  # launches the packaged app, opens a fixture and plays it
pnpm check:files    # the real-file pass over fixtures/ and local-tabs/ (docs/reference/player-checklist.md)
pnpm e2e            # the player flows: Playwright Test against the production build (vite preview) in headless Chromium; needs pnpm sounds:fetch
```

`pnpm --filter @reprise/web preview` serves the last build.

`pnpm desktop:build` writes installers to `apps/desktop/release/`: on macOS a `.dmg` and a `.zip` for both arm64 and x64, on Windows an NSIS installer. The builds are unsigned, so the first time you open the macOS app, right-click it in Finder and choose **Open**, then confirm. After that it opens normally.

`pnpm install` also downloads the headless Chromium shell (about 100 MB) that the `audio` tests run in. `pnpm exec playwright install chromium` adds the full browser, needed only to watch those tests with `--browser.headless=false`, or the player flows with `pnpm e2e --headed` or `--ui`. The Electron binary is downloaded the first time `pnpm desktop:dev` or `pnpm desktop:build` runs.

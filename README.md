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
- pnpm 11: `corepack enable pnpm` installs the version `package.json` pins (corepack ships with Node 24; on Node 25 or newer, `npm i -g corepack` first, or see [pnpm's installation page](https://pnpm.io/installation))

pnpm is the only package manager. npm refuses to install or run anything: at the root it stops at the `workspace:` dependencies, and every package's `devEngines` names pnpm. A `preinstall` guard stops yarn and bun.

## Commands

Run from the repository root. On a fresh clone start with `pnpm bootstrap`: it checks Node and pnpm, runs `pnpm install`, makes sure the Chromium headless shell, the Electron binary and the GM soundfont are in place, and prints the next commands. It is safe to re-run. (Not `pnpm setup`, which is a pnpm built-in that edits your shell profile.)

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
pnpm desktop:dev    # the Electron app around the same web core; the renderer hot-reloads, main and preload restart the app
pnpm desktop:build  # fetches the GM sound bank, electron-vite build, then electron-builder for the current platform
pnpm desktop:smoke  # launches the packaged app, opens a fixture, plays it and copies to the clipboard
pnpm check:files    # the real-file pass over fixtures/ and local-tabs/ (docs/reference/player-checklist.md)
pnpm e2e            # the player flows: Playwright Test against the production build (vite preview) in headless Chromium; needs pnpm sounds:fetch
```

`pnpm --filter @reprise/web preview` serves the last build.

`pnpm desktop:build` writes installers for the machine's own architecture to `apps/desktop/release/`: on macOS a `.dmg` and a `.zip`, on Windows an NSIS installer. Releases ([how](docs/reference/release.md)) carry arm64 and x64 for macOS and x64 for Windows. The builds are unsigned, so the first time you open the macOS app, right-click it in Finder and choose **Open**, then confirm; on macOS 15 and later use System Settings → Privacy & Security → **Open Anyway** instead. After that it opens normally.

`pnpm install` also downloads the headless Chromium shell (about 100 MB) that the `audio` tests run in. `pnpm exec playwright install chromium` adds the full browser, needed only to watch those tests with `--browser.headless=false`, or the player flows with `pnpm e2e --headed` or `--ui`. `pnpm bootstrap` downloads the Electron binary up front; without it, the first `pnpm desktop:dev` or `pnpm desktop:build` does.

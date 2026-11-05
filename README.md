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

## Prerequisites

- Node 24 (see `.nvmrc`)
- pnpm 11

## Commands

Run from the repository root after `pnpm install`.

```
pnpm lint           # ESLint, including the package boundary rules; fails on any warning
pnpm typecheck      # tsc -b across every package, incremental
pnpm test           # Vitest, every package as its own project
pnpm test:watch
pnpm format         # Prettier; format:check verifies without writing
pnpm dev            # the web app in the browser, Vite dev server with hot reload
pnpm build          # production build of the web app into apps/web/dist
```

`pnpm --filter @reprise/web preview` serves the last build.

Not yet available (each prints a notice and exits successfully until its work package lands):

```
pnpm desktop:dev    # the Electron app (WP-004)
pnpm desktop:build  # the Electron package (WP-004)
pnpm e2e            # Playwright against the Electron build (WP-004)
```

`pnpm install` also downloads the headless Chromium shell (about 100 MB) that the `audio` tests run in. `pnpm exec playwright install chromium` adds the full browser, needed only to watch those tests with `--browser.headless=false`.

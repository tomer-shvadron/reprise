# Reprise

A Guitar Pro style tab player, trainer and editor for the desktop. Built so one person can play guitar again.

Reprise opens Guitar Pro files (gp3, gp4, gp5, gpx, gp), renders them as tab with rhythm notation or standard notation, plays them back with sampled instruments at any tempo, loops sections for practice, and lets you write and edit tabs. It runs as an Electron app on macOS, with Windows builds in CI.

Status: **planning complete, implementation not started.** See `docs/plans/roadmap.md` for what comes next.

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

Not yet available; they arrive with the foundation phase. The intended set:

```
pnpm dev            # web app in the browser
pnpm desktop:dev    # the Electron app
pnpm lint
pnpm typecheck
pnpm test
```

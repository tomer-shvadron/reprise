# ADR-0009: pnpm workspace monorepo with six packages, no build orchestrator

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The requirement that the engines stay framework-free, so they are testable in isolation and
portable to a Web Worker, is only real if something enforces it. In a single package nothing
stops a React import from leaking into the audio engine. The owner asked which build tool to
use: Turborepo, Nx, plain pnpm workspaces, or something else.

The stack is otherwise fixed by the owner's existing projects: TypeScript, React, Vite,
Tailwind, Zustand, pnpm, Vitest, Playwright.

## Decision

A pnpm workspace with six packages along the real seams:

| Package              | Path                | Contents                                                        | May depend on        |
| -------------------- | ------------------- | --------------------------------------------------------------- | -------------------- |
| `@reprise/model`     | `packages/model`    | Score data model, timing, commands, undo. Pure TypeScript.      | nothing              |
| `@reprise/formats`   | `packages/formats`  | gp3/4/5, gp, gpx readers; native and gp writers; sniffer.       | model                |
| `@reprise/layout`    | `packages/layout`   | Score → positioned glyphs. Pure TypeScript, worker-capable.     | model                |
| `@reprise/audio`     | `packages/audio`    | Sampler, scheduler, loaders, effects, memory manager. Web Audio.| model                |
| `@reprise/web`       | `apps/web`          | The React UI; renders layout output and drives the engines.     | all packages         |
| `@reprise/desktop`   | `apps/desktop`      | Electron shell and the platform adapter.                        | web                  |

Rules:

- **pnpm workspaces alone.** No Turborepo, no Nx. Packages are consumed as TypeScript source
  by Vite, so there is no per-package build step to orchestrate.
- **Typechecking** uses `tsc -b` with project references, incremental across packages.
- **Tests** use Vitest's projects feature, one root command running every package's suite.
- **The desktop package** uses electron-vite for the main, preload and renderer builds.
- **Boundaries are lint rules**: no React or DOM imports in `packages/*`, no imports between
  packages other than those in the table, no Electron imports outside `apps/desktop`.
- **Documented trigger to revisit**: add Turborepo if CI time exceeds a few minutes.

## Alternatives considered

- **Single package, folders by concern**: fastest to start; boundaries would erode. Rejected.
- **Turborepo**: earns its keep with caching and task ordering for build graphs; there is no
  build graph here. Recorded as the escalation path rather than the starting point.
- **Nx**: a framework with generators and its own configuration layer, weight a one-developer
  repository never recovers. Rejected.

## Consequences

- The three engine packages are independent of each other, which is what makes the parallel
  lanes of ADR-0016 possible: one agent per package, no shared files.
- The `layout` package can move to a Web Worker later without touching other packages.
- Workspace setup is a one-off task in the foundation milestone.

## Related

- `../specs/shared-understanding.md`
- `0003-desktop-only-electron.md`
- `0014-repo-and-process.md`
- `0016-build-order-and-parallel-lanes.md`

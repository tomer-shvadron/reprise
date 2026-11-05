# Phase 0: Foundation `[S]`

Serial, done by the lead. Exit condition: workspace, CI, web and desktop shells, governance and fixtures exist, and a deliberate boundary violation fails lint.

Everything here is scaffolding. The goal is that a lane agent can clone, install, run one command and have lint, typecheck and tests pass on its package, with the boundaries that keep lanes independent already enforced.

---

## WP-001: Workspace scaffold

- **Lane**: lead · **Size**: M · **Blocked by**: nothing
- **Packages**: root, `packages/model`, `packages/formats`, `packages/layout`, `packages/audio`, `apps/web`, `apps/desktop` (all as empty shells with an `index.ts` and one smoke test)

**Deliverables**

- `pnpm-workspace.yaml` with `packages/*` and `apps/*`. Root `package.json` with scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `test:watch`, `format`, `format:check`, `e2e`, `desktop:dev`, `desktop:build`.
- `tsconfig.base.json`: strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2022 target, bundler resolution, `verbatimModuleSyntax`. Each package has its own `tsconfig.json` extending it with `references` to its dependencies; root `tsconfig.json` is a solution file so `tsc -b` checks everything incrementally.
- ESLint flat config with `typescript-eslint` (strict-type-checked), `eslint-plugin-import-x`, `eslint-plugin-react` and hooks for `apps/web` only, `eslint-plugin-unicorn` for filename-case. **Boundaries**: a rule set that forbids `react`, `react-dom`, `@radix-ui/*`, `zustand` and `dexie` anywhere under `packages/`; forbids `@reprise/formats`, `@reprise/layout` and `@reprise/audio` from importing each other; forbids deep imports (anything other than a package's root export). `--max-warnings 0`.
- Prettier with the Tailwind plugin. Husky pre-commit running lint-staged (eslint + prettier on staged files) and `pnpm typecheck`.
- Vitest configured with projects: one per package, `node` environment for `model` and `formats`, `jsdom` for `web`, and a browser-like environment for `layout` and `audio` (decided in this WP; `happy-dom` or Vitest browser mode, whichever passes a Web Audio smoke test).
- `.nvmrc` (24), `.editorconfig`, `.gitignore` covering `node_modules`, `dist`, `*.tsbuildinfo`, `playwright-report`, `test-results`, `coverage`, `local-tabs/`, `.env*`, Electron build output.
- `README.md` at the root: what Reprise is, prerequisites, the five commands, a link to `docs/README.md`.

**Acceptance criteria**

- Fresh clone: `pnpm install && pnpm lint && pnpm typecheck && pnpm test` passes.
- Adding `import React from 'react'` to `packages/model/src/index.ts` makes `pnpm lint` fail with the boundary rule named in the output. The PR shows this check in its description and reverts it.
- Adding `import {} from '@reprise/layout'` in `packages/audio` fails the same way.
- `pnpm test` runs all projects from the root and reports per package.

---

## WP-002: Continuous integration

- **Lane**: lead · **Size**: S · **Blocked by**: WP-001
- **Packages**: `.github/workflows`

**Deliverables**

- `ci.yml`: triggers on pull requests and pushes to `main`. Steps: checkout, pnpm with store cache, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` for `apps/web`. Concurrency group per branch with cancel-in-progress. Node from `.nvmrc`.
- A placeholder `release.yml` that runs only on `v*` tags and currently just builds `apps/web`; the Electron packaging is added in WP-102.
- Branch protection on `main`: require the CI check and one approving review.

**Acceptance criteria**

- A PR with a lint error shows a red check that names the step.
- A green PR shows the four steps in under the time it takes to review it; if it exceeds a few minutes, record that as the trigger for Turborepo per ADR-0009.

---

## WP-003: Web app shell

- **Lane**: lead · **Size**: M · **Blocked by**: WP-001
- **Packages**: `apps/web`

**Deliverables**

- Vite + React 19 + Tailwind v4, shadcn/ui initialised with the components the shell needs (button, dialog, dropdown, slider, switch, tooltip, command, scroll-area, separator, toggle-group).
- Theme tokens as CSS variables on `:root` for dark and light, with a `data-theme` attribute, system preference as the initial value, persisted in `localStorage`. A `paper` token family for the score surface.
- The app frame: a left sidebar region, a center score region, a bottom transport region, a right collapsible panel region. All placeholders with their final dimensions and resize behaviour.
- Command palette (cmdk via shadcn `command`) with a registry: commands declare `id`, `title`, `shortcut`, `run`. Two commands to start: toggle theme, open file (calls the platform adapter, which in the browser uses an `<input type="file">`).
- A keyboard-shortcut dispatcher that reads the same registry, so shortcuts and palette entries never drift.
- Zustand `ui` store: theme, panel visibility, zoom.

**Acceptance criteria**

- `pnpm dev` shows the frame; the palette opens with the platform shortcut; theme toggles and survives reload.
- React Testing Library test for the command registry and the shortcut dispatcher.
- No layout shift between themes.

---

## WP-004: Desktop shell and platform adapter

- **Lane**: lead · **Size**: M · **Blocked by**: WP-003
- **Packages**: `apps/desktop`, `apps/web/src/platform`

**Deliverables**

- `apps/desktop` with electron-vite: main, preload, renderer pointing at `apps/web`. Context isolation on, node integration off, a typed preload bridge exposed as `window.reprise`.
- The `Platform` interface from `../specs/architecture.md`, with a `browser` implementation (File System Access API where available, `<input type="file">` and download fallback otherwise, OPFS for `libraryDir` and `dataDir`) and an `electron` implementation that calls the bridge. A `platform()` accessor that picks the implementation at startup.
- Electron main: file open and save dialogs, read and write files, `libraryDir` resolving to `~/Music/Reprise` (created on first run), `dataDir` resolving to `app.getPath('userData')`, `print()` via `webContents.print`, native application menu with File (Open, Save, Save As, Print, Quit), Edit (Undo, Redo, Cut, Copy, Paste as roles), View (zoom in/out/reset, toggle theme, toggle panels), Window, Help (open docs URL).
- Window state (bounds, maximised) persisted and restored.
- electron-builder config: macOS `dmg` and `zip` for arm64 and x64, Windows `nsis`; no signing configuration yet. `pnpm desktop:build` produces a macOS artifact locally.

**Acceptance criteria**

- `pnpm desktop:dev` opens the frame in Electron; File → Open returns bytes to the renderer through the adapter, and the same code path works in the browser with `pnpm dev`.
- The preload bridge is typed end to end; an IPC channel added without a type fails typecheck.
- A built `.dmg` launches on macOS after right-click Open.

---

## WP-005: Repository governance

- **Lane**: lead · **Size**: S · **Blocked by**: WP-001
- **Packages**: `.github`, `docs`

**Deliverables**

- Issue templates: `work-package.md` (the fields from `roadmap.md`: lane, size, blocked by, packages, deliverables, acceptance criteria, briefing list) and `bug.md`.
- PR template: linked issue, what changed, how it was verified, budget measurements if applicable, screenshots for UI.
- A `scripts/github/bootstrap.sh` that creates the labels (`area:*`, `type:*`, `phase:*`, `lane:*`), the milestones (Player, Library, Trainer, Editor, HQ Sound, Release), and the Projects board with its five columns, idempotently, via `gh`.
- `docs/reference/keyboard-shortcuts.md` created as a stub to be filled by WP-101.
- `CONTRIBUTING.md`: the lane rules from `roadmap.md`, the briefing order from `docs/README.md`, and the commit and PR conventions.

**Acceptance criteria**

- Running the bootstrap script twice leaves GitHub in the same state.
- A new issue from the template renders every field.

---

## WP-006: Test fixture corpus

- **Lane**: lead · **Size**: S · **Blocked by**: WP-001
- **Packages**: `fixtures`

**Deliverables**

- `fixtures/` with open-licensed Guitar Pro files covering gp3, gp4, gp5, gpx and gp, taken from alphaTab's and TuxGuitar's test data, each with its source URL and license noted in `fixtures/LICENSES.md`.
- `fixtures/manifest.json`: for each file, the format, the features it exercises (repeats, voltas, jumps, tuplets, bends, drums, pitched track, time-signature change, key change, lyrics, chords, multiple voices), and the alphaTab-reported counts of tracks, bars and notes for use as expected values.
- `local-tabs/` in `.gitignore` with a `local-tabs/README.md` that is committed, explaining it holds Tomer's downloaded tabs for manual testing only.
- A script `scripts/fixtures/describe.ts` that loads every fixture through alphaTab (dev dependency) and regenerates the manifest counts.

**Acceptance criteria**

- Every format has at least two fixtures; every feature in the list is exercised by at least one fixture.
- The describe script runs clean and the manifest is reproducible.

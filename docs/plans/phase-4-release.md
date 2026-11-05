# Phase 4: Release `[S]`

Serial, done by the lead. Exit condition: v1 tagged, macOS and Windows installers attached to a GitHub Release, the light theme audited, the shortcut map complete.

---

## WP-100: Light theme audit

- **Size**: S · **Blocked by**: all phase 3 checkpoints
- **Packages**: `apps/web`

**Deliverables**

- Every screen and panel reviewed in the light theme: contrast of score ink on paper, cursor and selection visibility, mixer and panel chrome, dialogs, toasts, the print view. Fixes applied to tokens, not to components, wherever possible.
- Screenshots of each screen in both themes attached to the PR.

**Acceptance criteria**

- No component references a raw color; a token grep in CI confirms it.

## WP-101: Command palette and shortcut map

- **Size**: S · **Blocked by**: all phase 3 checkpoints
- **Packages**: `apps/web`, `docs/reference`

**Deliverables**

- Every command in the registry has a palette entry, a category and a shortcut where Guitar Pro has one; conflicts resolved; `docs/reference/keyboard-shortcuts.md` generated from the registry by a script so it cannot drift.
- A shortcuts cheat-sheet dialog in the app from the same data.

**Acceptance criteria**

- A test asserts no two commands share a shortcut in the same context and that the reference doc is up to date.

## WP-102: Windows build and release workflow

- **Size**: M · **Blocked by**: all phase 3 checkpoints
- **Packages**: `apps/desktop`, `.github/workflows`

**Deliverables**

- `release.yml` completed: on a `v*` tag, build on macOS and Windows runners with electron-builder, attach the dmg, zip and nsis installers to a GitHub Release with generated notes; unsigned, with the right-click-Open note in the release body.
- A Windows smoke test on the runner: launch the built app, open a fixture, exit cleanly.
- Version bumped from the tag; the app shows its version in the About dialog.
- Hardening before the first public installer: Electron fuses set in an `afterPack` hook through `@electron/fuses` (`RunAsNode`, `EnableNodeCliInspectArguments` and `EnableNodeOptionsEnvironmentVariable` off, `OnlyLoadAppFromAsar` on), `app.enableSandbox()` before `ready`, and an app icon for both platforms.
- A Content-Security-Policy on the renderer. A `script-src` without `'unsafe-inline'` blocks the inline theme bootstrap in `apps/web/index.html` and brings back the dark flash for light-theme users: either hash that script in the policy or move it to a classic (non-module) script file, with a test pinning whichever is chosen, as `theme.test.ts` pins the bootstrap today.
- Local `pnpm desktop:build` packages the host architecture only; CI builds both macOS architectures and Windows.

**Acceptance criteria**

- A `v1.0.0-rc.1` tag produces a release with three installers; the macOS one runs on Tomer's machine.

## WP-103: Budgets final

- **Size**: S · **Blocked by**: all phase 3 checkpoints
- **Packages**: tests

**Deliverables**

- The budgets table in the roadmap reconciled with measured values after all checkpoints; any budget that is now comfortably met is tightened; the benchmark runs on every PR.

**Acceptance criteria**

- Budgets pass on the release candidate.

## WP-104: v1 release

- **Size**: S · **Blocked by**: WP-100, WP-101, WP-102, WP-103
- **Packages**: `docs`, root

**Deliverables**

- `v1.0.0` tag; the root README updated with screenshots and install instructions; `docs/plans/roadmap.md` marked with what shipped and a pointer to a new `phase-5-after-v1.md` listing the deferred items from `scope-v1.md` as candidates.
- The player checklist from WP-054 run one last time on the release build.

**Acceptance criteria**

- The release page has installers, notes and screenshots, and Tomer has learned a song on it.

# ADR-0025: End-to-end flows on the web build in Chromium

- **Status**: Accepted
- **Date**: 2026-11-07
- **Deciders**: the lead's ruling on #51, which the owner can overrule

## Context

ADR-0015's **App** bullet calls for "Playwright end-to-end against the Electron build for the core
flows: open a file, play, loop, edit a note, save, print preview", and ADR-0023 left that line
standing. WP-055 (#51) builds the suite, and its plan text said "against the Electron build",
"print to PDF" and "green in CI on macOS runners".

Three things argue against the Electron build:

- The phase-4 hardening turns off the `EnableNodeCliInspectArguments` fuse, which stops
  Playwright's `_electron.launch` (measured in #93: it times out).
- It needs macOS runners beside the Linux one every other job uses, and native file dialogs
  would need stubs in the main process anyway.
- The Electron layer is thin: main, preload and the platform adapter. `apps/desktop`'s unit tests
  cover it, and `pnpm desktop:smoke` (#104) launches the packaged app, opens a fixture and plays
  it on macOS and Windows.

The plan on #51 measured that a realtime `AudioContext` runs in Linux headless Chromium with no
sound device: it reaches `running`, its clock advances, and a tap on the master bus hears the song
(RMS 0.015 against 0.022 on macOS), so audio can be asserted on a Linux runner.

## Decision

It supersedes ADR-0015's **App** bullet and ADR-0023's remark that the Electron e2e stands.

- **The player flows are a Playwright Test suite against the production web build**, served by
  `vite preview`, in the Chromium headless shell: `apps/web/e2e/player/`, run by `pnpm e2e`.
  No Firefox, no WebKit, no Electron.
- **Everything above the `Platform` interface is covered.** Below it the browser platform runs,
  with its File System Access pickers stubbed onto origin-private storage.
- **The Electron coverage is the packaged smoke check from #104**, `pnpm desktop:smoke`, plus
  `apps/desktop`'s unit tests.
- **Audio is asserted without listening**: through a tap on the master bus, the transport
  position the readout shows, and the engine state on the controls. No sleeps: every wait is on
  app state.
- **No pixels**: the suite asserts structure, and screenshot comparison stays in the visual
  suite (ADR-0023).
- **CI runs it as its own required job, `e2e`**, beside `ci`, on every pull request and push to
  `main`, on the pinned Linux runner.
- **Print checks move to WP-025** (Printing), whose acceptance already names print to PDF from
  Electron.

## Alternatives considered

- **`_electron.launch` on macOS runners**, as ADR-0015 read literally: blocked by the fuse, a
  second runner platform, and still stubbing native dialogs in main. Rejected.
- **Vitest browser mode**, as ADR-0023 chose for pixels: the flows need the built app at a URL,
  with reload, the page's own pickers and window-level drops, which a component mounted in
  Vitest's iframe does not have, while the `web-browser` project already covers integration at
  that level. Rejected.

## Consequences

- A second test runner, `@playwright/test`, for this one suite, with its own config
  (`apps/web/playwright.config.ts`).
- The two renderer budget rows (heap after opening the long score, drop to first paint) are
  measured by this suite rather than `pnpm bench`.
- A regression only Electron shows is caught by `pnpm desktop:smoke`, which runs by hand and in
  the release workflow, not on every PR.

## Related

- `0015-testing-strategy.md`
- `0023-visual-regression-in-vitest-browser-mode.md`
- `../plans/phase-2-lanes-to-player.md` (WP-055)
- `../../apps/web/e2e/player/README.md`

# Which Vitest environment runs Web Audio for `@reprise/audio`

- **Date**: 2026-11-05
- **Asked by**: WP-001 (also needed by WP-035)

## Question

The `audio` package is tested against an `OfflineAudioContext` (ADR-0015). Which Vitest
environment provides one: a DOM polyfill (`happy-dom`, `jsdom`) or Vitest browser mode?

## What was tried

- A smoke test in `packages/audio/src/index.test.ts` that constructs a two-channel
  `OfflineAudioContext` of 4,410 frames at 44.1 kHz, renders it, and asserts every sample is
  zero.
- Checked whether `OfflineAudioContext` and `AudioContext` exist on a `happy-dom` 20.x and
  21.0.4 `Window`, a `jsdom` 30.1 window, and Node 24's global scope.
- Ran the smoke test under Vitest 5.1 browser mode with `@vitest/browser-playwright` and
  headless Chromium (Playwright 1.64), five consecutive runs of `vitest run --project audio`.

## Findings

| Environment                           | `OfflineAudioContext` | Smoke test        |
| ------------------------------------- | --------------------- | ----------------- |
| Node 24                               | absent                | cannot run        |
| `jsdom` 30.1                          | absent                | cannot run        |
| `happy-dom` 20.x, 21.0.4              | absent                | cannot run        |
| Vitest browser mode, headless Chromium | native               | passes, 5 of 5    |

- Neither DOM polyfill implements any part of Web Audio. Using one would mean adding a
  separate Web Audio polyfill (for example `standardized-audio-context-mock`), which tests
  against a mock rather than the real renderer and defeats the point of sample-accurate
  assertions.
- Browser mode runs the real Chromium audio renderer. Each run of the audio project took
  roughly 0.36 s with the browser already downloaded; no flakiness was observed.
- The cost is a Chromium download. `playwright install chromium` fetches two builds, the full
  Chromium and `chromium_headless_shell` (366 MB and 203 MB on disk, Playwright 1.64 on macOS
  arm64). Under `headless: true` Playwright launches only the shell, and the smoke test passes
  with just `playwright install chromium --only-shell`, a 99 MiB download. The root `postinstall`
  runs that, a no-op when the build is cached. CI (WP-002) should cache
  `~/Library/Caches/ms-playwright` or `~/.cache/ms-playwright`.

## Conclusion

`@reprise/audio` runs in Vitest browser mode with the Playwright provider and headless
Chromium, configured in the root `vitest.config.ts`. `layout` stays in the `node` environment:
it is pure TypeScript by design and never touches the DOM, so a browser-like environment
would only hide a boundary violation. Picked up by WP-001; WP-002 adds the browser cache to CI,
and WP-035 builds the audio test harness on this setup.

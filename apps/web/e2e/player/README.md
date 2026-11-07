# Player flows

End-to-end flows of the player, in Playwright Test against the production build (`pnpm build`, served by `vite preview` on port 4319) in the Chromium headless shell ([ADR-0025](../../../../docs/decisions/0025-end-to-end-on-the-web-build-in-chromium.md)). They cover everything above the `Platform` interface; the Electron adapter is covered by `apps/desktop`'s unit tests and `pnpm desktop:smoke`.

## Running

```sh
pnpm sounds:fetch                          # once: the build copies the GM bank into dist/
pnpm e2e                                   # the whole suite, one worker, about 1.5 min
pnpm e2e seek.spec.ts                      # one file
pnpm e2e -g 'count-in'                     # tests whose title matches
pnpm e2e --repeat-each 3                   # check a change for flakiness
pnpm e2e --headed                          # watch it; needs `pnpm exec playwright install chromium`
pnpm exec playwright show-report apps/web/playwright-report
pnpm exec playwright show-trace path/to/trace.zip
```

`pnpm test` and the pre-commit hook never run these files. On a failure the trace, the video and a screenshot of each failed test land in `apps/web/test-results/`; CI uploads them with the HTML report as the `e2e-results` artifact, which `show-trace` opens after download.

## The hooks

`test/page-hooks.ts` runs in the page before the app's modules (`page.addInitScript`) and installs `window.__e2e`:

- **Master-bus tap.** `AudioNode.prototype.connect` is wrapped so that a connection to a realtime context's destination goes through a gain that also feeds an `AnalyserNode`. The sampler, the metronome and the count-in all reach the destination that way, so `level()` hears everything the user would. "Sounding" is RMS above 1e-3 (the song measures about 0.02); "silent" is a peak below 1e-4.
- **Context count.** `AudioContext` is wrapped in a `Proxy` that records each one constructed; the app must make exactly one.
- **Pickers.** `showOpenFilePicker` counts its calls in `opens` and returns the next name pushed to `picks` from origin-private storage, or throws `AbortError` (the user's cancel) when there is none; `showSaveFilePicker` records its options in `saves` and creates the file there. They are real `FileSystemFileHandle`s, so Save in place runs the app's own write path.
- **Write log.** `createWritable().close()` is wrapped to push `{ name, size }` to `writes` once it resolves. Read a saved file only after its entry appears: reading earlier races the browser's swap file (`NotFoundError` or `NotReadableError`).
- **Probes** sample every animation frame with a 20 s guard that resolves rather than hangs: `peakWhile` (the loudest frame while a readout field shows a text), `beatInterval`, `barTrail` and `watchFollow`.

`test/app.ts` is the `app` fixture: a fresh context per test (empty storage), the hooks, `page.goto('/')`, and helpers that open files, drop them, map score coordinates and read the hooks.

## Rules

- **No sleeps.** Wait on app state: web-first `expect(locator)` assertions, `expect.poll` on the analyser, or `page.waitForFunction` on the probes and the write log. `waitForTimeout` and `setTimeout` are ESLint errors here.
- **Click in content coordinates.** A seek scrolls the score, smoothly. Learn a box with `contentBox` or `barBox` (scroll-content coordinates) and click it with `clickContent`, which waits for the scroll to settle and the point to be in view, then maps it to the viewport. `settle()` waits for the score region to drop `data-scrolling`, which the view sets while its own smooth scroll is in flight, and throws after 5 s.
- **Press a key before a flow that needs audio without Play.** The first key or pointer press builds the one `AudioContext`; `gesture()` presses a key that is no shortcut and waits for the context to run.
- **Scope mixer controls to the strip** (`app.strip(n)`): Mute, Solo and Volume exist in the sidebar row too.
- **Press `ControlOrMeta`**, never `Meta` or `Control`, and keep the real user agent (no `devices[...]`): the app picks its modifier from the user agent.
- **No screenshots compared.** Pixels belong to the visual suite (`../visual/`).

## Scores

`test/global-setup.ts` checks the GM bank is fetched, then writes into `.generated/` (gitignored) from `largeScore` and the formats writer:

| File                  | What                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `song.gp`, `.reprise` | 2 guitar tracks × 16 bars at 90 BPM, 3/4 at bars 5, 10 and 15, bars 1–8 and 9–16 each played twice, `1:21` long; facts in `scores.ts` |
| `song48.gp`           | the same at 48 bars, for following across pages                                                                                       |
| `long-score.reprise`  | the roadmap's reference long score, 8 × 300 bars with track _i_ in tab, standard or both notation, for the budget rows                |

The committed fixtures give one file per format (`FORMATS` in `scores.ts`), with bar counts from `fixtures/manifest.json`.

## Budgets

`budgets.spec.ts` measures the roadmap's two renderer rows against the table itself (`scripts/bench/budgets.ts`, with the CI factor on the time row): drop to first paint as the median of three fresh pages, and V8's used heap after a forced garbage collection, with the audio engine built by a first key press and the long score's song loaded and played for a moment. Each prints a `budget:` line and, on CI, a row in the job summary.

## Running in CI's Linux browser locally

CI runs on `ubuntu-24.04` with no sound device. To reproduce it, run Playwright's server in its image and point the suite at it:

The browser in the container must reach the preview at `127.0.0.1:4319`, a secure origin (origin-private storage needs one; `host.docker.internal` is not), so the container forwards that port to the host:

```sh
docker run --rm -d --name pw-e2e -p 3000:3000 --init mcr.microsoft.com/playwright:v1.64.1-noble /bin/sh -c \
  "apt-get -qq update && apt-get -qq install -y socat; \
   (socat TCP-LISTEN:4319,fork,bind=127.0.0.1 TCP:host.docker.internal:4319 &); \
   npx -y playwright@1.64.1 run-server --port 3000 --host 0.0.0.0"
```

Then run the suite with a local config beside `playwright.config.ts` (not committed), and `docker rm -f pw-e2e` after:

```ts
import { defineConfig } from '@playwright/test';

import base from './playwright.config';

export default defineConfig(base, {
  use: { connectOptions: { wsEndpoint: 'ws://127.0.0.1:3000/' } },
});
```

## Adding a flow

Put it in the spec file of its area, start from the `app` fixture, open a generated score or a fixture, and assert through the readout, the controls' accessible names and states, and the hooks. Add a fact to `scores.ts` rather than repeating a number.

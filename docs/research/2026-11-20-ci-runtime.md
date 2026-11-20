# How to cut CI and pre-commit wait without losing coverage

- **Date**: 2026-11-20
- **Asked by**: #379 (the owner: "so we spend less time in commits and ci waiting")

## Question

Two waits matter: the local pre-commit hook, whose `vitest related` pulls in most of the suite when a widely imported file changes and hangs or fails when the Mac is loaded, and the wall time until a PR is mergeable (the required `ci` check, the `e2e` job the lead also waits for, and the `release.yml` `package (...)` jobs on PRs that touch the desktop build). Where does the time go, and which changes cut it without dropping any check the PR gate runs today?

## What was tried

- Job and step durations from the GitHub API for 24 `ci.yml` runs: the latest 24 successful runs created before 20:33 UTC on 2026-11-20, which were created between 11:12:57 and 20:32:07 UTC (`main` pushes and PRs, all attempt 1). The API lists 44 successful runs created before that cut-off (00:15 to 20:32 UTC); the sample is the last 24 of them, and the earlier 20 are left out. Re-selecting them this way reproduces the baseline tables below (`ci` 549 / 683 / 804 s, `e2e` 326 / 360 / 372 s). Release workflow figures cover the 12 `release.yml` PR runs created on 2026-11-20 up to 20:40 UTC, of which one was cancelled (44713232804, a superseded push), leaving 11 timed runs. The run IDs are in the appendix.
- Per-test durations parsed from five `ci` job logs (the `verbose` reporter prints every test with its time; a file's figure below is the sum of its tests, so it leaves out import, setup and environment time) and five `e2e` job logs (Playwright's `list` reporter). The IDs of those ten logs were not recorded when the research was done and cannot be recovered with certainty; see the appendix.
- The pre-commit selection estimated statically: a reverse-import closure over `apps/`, `packages/` and `scripts/` (relative, `@/` and `@reprise/*` specifiers, `vi.mock` paths), joined with the CI per-file times. This approximates `vitest related`, which walks Vite's module graph; nothing heavy was run locally, because the machine was shared (load average 9 to 40 on a 14-core M4 Pro).
- Runners: `ubuntu-24.04` (GitHub's standard Linux runner for public repositories: 4 vCPU, 16 GB), `macos-15` (arm64, 3 vCPU), `macos-15-intel` (4 vCPU), `windows-2025` (4 vCPU). Queue time before a job starts was 1 to 4 s in every run (median 2 s), so queueing is not a cost today.

## Findings

### Baseline: jobs (24 `ci.yml` runs, 11 timed `release.yml` runs)

| Job                      | Median | p90   | Worst | Runs        | Notes                                                                 |
| ------------------------ | ------ | ----- | ----- | ----------- | --------------------------------------------------------------------- |
| `ci` (required)          | 549 s  | 683 s | 804 s | 24          | every check, one after another                                        |
| `e2e`                    | 326 s  | 360 s | 372 s | 24          | 62 to 81 tests per run in this sample, by branch and time: grows with every feature |
| `bench-compare`, gated off | ~30 s | 39 s | 39 s | 15          | no watched path changed                                              |
| `bench-compare`, ran     | ~460 s | -     | 499 s | 2           | 10 alternating bench runs of ~44 s; not required yet                  |
| `package (mac-x64)`      | 263 s  | 338 s | 363 s | 11 (of 12) | the slowest packaging job                                             |
| `package (windows-x64)`  | 169 s  | 182 s | 197 s | 11          |                                                                       |
| `package (mac-arm64)`    | 161 s  | 168 s | 191 s | 11          |                                                                       |
| `release.yml` wall       | 278 s  | 374 s | 386 s | 11          | `gate` (10 s) then the three packages in parallel                     |

**Critical path to mergeable today**: `ci`, median 551 s (p90 687 s, worst 806 s) from the first job created to the last of `ci` and `e2e` finished. `e2e` usually finishes first, 2 to 4 minutes earlier (114 to 220 s in the runs spot-checked). On a desktop-touching PR the release workflow (median 278 s) also finishes inside `ci`.

### Baseline: steps of `ci` (24 runs)

| Step                                   | Median | p90   | Worst | Share of median |
| -------------------------------------- | ------ | ----- | ----- | --------------- |
| Setup (job, checkout, pnpm, Node, caches, install, Chromium, sounds) | 28 s | 40 s | 52 s | 5% |
| Lint                                   | 72 s   | 87 s  | 102 s | 13%             |
| Typecheck                              | 18 s   | 23 s  | 28 s  | 3%              |
| Format                                 | 14 s   | 18 s  | 21 s  | 3%              |
| **Test** (`pnpm test`)                 | 257 s  | 343 s | 406 s | 47%             |
| **Bench** (`pnpm bench`)               | 86 s   | 105 s | 128 s | 16%             |
| Fixtures                               | 1 s    | 1 s   | 1 s   | 0%              |
| Real-file pass                         | 38 s   | 51 s  | 57 s  | 7%              |
| Build                                  | 2 s    | 2 s   | 2 s   | 0%              |
| Visual                                 | 16 s   | 21 s  | 24 s  | 3%              |
| Uploads, post steps                    | 3 s    | 4 s   | 5 s   | 1%              |

Steps of `e2e`: setup 27 s median (install 6 s, browsers cached), E2E 290 s median (p90 311 s, worst 336 s), over all 24 sample runs; the 62 to 81 tests in them are why this is lower than the 318 s of the 81-test run quoted below. The Vite build inside Playwright's `webServer` takes about 2 s.

Setup costs about 28 s per job (40 s p90), and `pnpm install` from the cached store is 6 s. **A new parallel job costs about half a minute of wall time**, so splitting anything longer than about a minute pays.

### Where the time goes inside `pnpm test`

Vitest's own summary over five runs: Duration 238 to 405 s on the same suite (the spread is the runner, not the code), split as tests 55%, setup files 16%, environment 14%, import 9%, transform 5% (of the tracked time summed over every project, about 1 150 s if the ~636 s of tests is the 55%). Separately, Vitest's jsdom warning counts only the `web` project: its jsdom is created once per file (215 to 233 times) and costs 27% of the `web` project's own tracked time, 116 to 205 s of worker time per run. The two shares have different denominators and are not additive; the 14% environment figure is all projects, the 27% only `web`.

Sum of test time per project (median of five runs, excluding import, setup and environment):

| Project         | Files | Test time | Runs in            |
| --------------- | ----- | --------- | ------------------ |
| `web`           | 236   | 213 s     | jsdom              |
| `layout`        | 25    | 194 s     | node               |
| `audio`         | 45    | 127 s     | Chromium           |
| `web-browser`   | 20    | 53 s      | Chromium           |
| `formats`       | 29    | 23 s      | node               |
| `model`         | 31    | 14 s      | node               |
| `audio-node`    | 17    | 5 s       | node               |
| `scripts`       | 22    | 5 s       | node               |
| `desktop`       | 21    | 1 s       | node               |
| `layout-worker` | 1     | 0.6 s     | Chromium           |
| **Total**       | 447   | ~636 s    |                    |

About 636 s of test time plus about 120 to 200 s of jsdom and the per-file setup, on 4 vCPU, comes to the 240 to 400 s observed: **the step is CPU-bound, not held up by one long file.** Splitting files alone does not shorten CI; more CPU (sharding across runners) or less work does. Long files matter for shard balance and for the hook, where one 97 s file is the long pole on a many-core Mac.

### Slowest test files per project (median and worst of five runs, seconds of test time)

`layout` (the five largest are 87% of the project):

| File                                  | Median | Worst |
| ------------------------------------- | ------ | ----- |
| `src/cache-property.test.ts`          | 96.8   | 120.9 |
| `src/layout.test.ts`                  | 41.7   | 51.8  |
| `src/hit-test.test.ts`                | 11.3   | 15.3  |
| `src/narrow.test.ts`                  | 11.1   | 14.1  |
| `src/stray.test.ts`                   | 8.8    | 11.8  |
| `src/cache.test.ts`                   | 8.5    | 9.7   |
| `src/staves/standard/standard.test.ts`| 3.7    | 4.8   |
| `src/staves/tab/tab.test.ts`          | 2.8    | 4.0   |
| `src/stable-breaks.test.ts`           | 2.6    | 2.9   |
| `src/staves/standard/unisons.test.ts` | 2.3    | 4.6   |
| `src/staves/standard/effects.test.ts` | 1.3    | 2.0   |
| `src/staves/effects/effects.test.ts`  | 1.0    | 1.6   |
| `src/split.test.ts`                   | 0.7    | 0.8   |
| `src/staves/words.test.ts`            | 0.4    | 0.7   |
| `src/furniture.test.ts`               | 0.3    | 0.7   |
| `src/staves/standard/rests.test.ts`   | 0.3    | 0.5   |
| `src/staves/dynamics.test.ts`         | 0.2    | 0.2   |
| `src/staves/standard/rhythm/beams.test.ts` | 0.1 | 0.1  |
| `src/staves/staff-module.test.ts`     | 0.1    | 0.1   |
| `src/staves/rhythm/grouping.test.ts`  | 0.0    | 0.0   |

`web` (jsdom):

| File                                                   | Median | Worst |
| ------------------------------------------------------ | ------ | ----- |
| `src/features/trainer/tuner/pitch/tracker.test.ts`     | 42.2   | 51.6  |
| `src/features/score/follow-long.test.tsx`              | 26.6   | 38.5  |
| `src/features/score/budget.test.ts`                    | 15.8   | 22.8  |
| `src/app/app.test.tsx`                                 | 5.3    | 6.2   |
| `src/features/score/score-index.test.ts`               | 4.8    | 6.8   |
| `src/features/editor/locate.test.ts`                   | 4.7    | 6.7   |
| `src/features/score/score-view.test.tsx`               | 4.0    | 5.0   |
| `src/features/sounds/sound-manager.test.tsx`           | 3.9    | 5.1   |
| `src/features/editor/track-dialog.test.tsx`            | 3.9    | 4.9   |
| `src/app/phase-3-entry-points.test.tsx`                | 3.9    | 4.1   |
| `src/features/editor/effects-panel.test.tsx`           | 2.9    | 3.9   |
| `src/features/score/playhead-view.test.tsx`            | 2.8    | 4.0   |
| `src/features/editor/effect-pickers.test.tsx`          | 2.5    | 3.0   |
| `src/features/library/library-screen.test.tsx`         | 2.5    | 3.0   |
| `src/features/editor/track-menu.test.tsx`              | 2.5    | 3.1   |
| `src/features/trainer/metronome/metronome-panel.test.tsx` | 2.5 | 2.8   |
| `src/features/score/print-document.test.tsx`           | 2.5    | 3.2   |
| `src/features/editor/bar-commands.test.tsx`            | 2.4    | 3.1   |
| `src/features/editor/effects-acceptance.test.ts`       | 2.4    | 2.7   |
| `src/app/right-panel/right-panel.test.tsx`             | 2.3    | 3.1   |

The other 216 web files take 0 to 2.3 s of test time each; for them jsdom creation and `src/test/setup.ts` cost more than the tests.

`audio` (Chromium):

| File                                       | Median | Worst |
| ------------------------------------------ | ------ | ----- |
| `src/test/attack-verification.test.ts`     | 45.3   | 51.9  |
| `src/test/fixtures.test.ts`                | 12.8   | 14.6  |
| `src/hq-memory-budget.test.ts`             | 12.0   | 15.1  |
| `src/sampler/sampler.test.ts`              | 11.7   | 18.4  |
| `src/effects/chain.test.ts`                | 8.4    | 9.7   |
| `src/samples/memory-budget.test.ts`        | 6.5    | 7.8   |
| `src/engine-packs.test.ts`                 | 3.4    | 4.2   |
| `src/test/loudness.test.ts`                | 2.9    | 4.5   |
| `src/engine-articulations.test.ts`         | 2.3    | 3.0   |
| `src/scheduler.test.ts`                    | 2.0    | 3.0   |
| `src/articulations/articulations.test.ts`  | 2.0    | 2.8   |
| `src/engine.test.ts`                       | 1.8    | 2.5   |
| `src/sf2/general-user-gs.test.ts`          | 1.5    | 2.1   |
| `src/test/harness.test.ts`                 | 1.4    | 1.6   |
| `src/sampler/layers-filter-choke.test.ts`  | 1.4    | 2.1   |
| `src/sampler/release-trigger.test.ts`      | 1.4    | 1.8   |
| `src/articulations/tied-links.test.ts`     | 1.1    | 1.6   |
| `src/transport.test.ts`                    | 1.0    | 1.6   |
| `src/effects/reverb-bus.test.ts`           | 1.0    | 1.2   |
| `src/test/fixture-schedule.test.ts`        | 0.8    | 0.9   |

`web-browser` (Chromium, all 20 files):

| File                                                      | Median | Worst |
| --------------------------------------------------------- | ------ | ----- |
| `src/features/library/drafts/draft-cost.browser.test.ts`  | 9.8    | 11.1  |
| `src/app/playhead.browser.test.tsx`                       | 8.5    | 10.4  |
| `src/app/player.browser.test.tsx`                         | 8.1    | 10.3  |
| `src/features/sounds/memory-panel.browser.test.tsx`       | 5.4    | 6.7   |
| `src/features/tracks/mixer.browser.test.tsx`              | 3.5    | 3.8   |
| `src/features/sounds/sound-packs.browser.test.tsx`        | 2.9    | 3.5   |
| `src/features/sounds/install/zip.browser.test.ts`         | 2.6    | 2.8   |
| `src/features/transport/transport.browser.test.tsx`       | 2.2    | 2.5   |
| `src/features/sounds/effects.browser.test.tsx`            | 2.1    | 3.0   |
| `src/features/library/import/parse-import.browser.test.ts`| 1.7    | 2.0   |
| `src/features/library/restore.browser.test.tsx`           | 1.3    | 1.3   |
| `src/features/trainer/tuner/tuner.browser.test.ts`        | 1.2    | 1.3   |
| `src/features/library/import/import-batch.browser.test.ts`| 1.1    | 1.2   |
| `src/app/audio/audio-service.browser.test.ts`             | 0.9    | 1.2   |
| `src/features/trainer/speed-trainer/speed-trainer.browser.test.ts` | 0.4 | 0.6 |
| `src/features/trainer/metronome/metronome.browser.test.ts`| 0.3    | 0.4   |
| `src/features/transport/tempo-control.browser.test.tsx`   | 0.3    | 0.4   |
| `src/features/transport/install-transport.browser.test.ts`| 0.2    | 0.2   |
| `src/features/editor/entry-sound.browser.test.ts`         | 0.2    | 0.2   |
| `src/app/audio/audio-service-packs.browser.test.ts`       | 0.2    | 0.2   |

`formats` top ten: `test/gp-writer.test.ts` 6.6 (7.8), `test/robustness.test.ts` 6.1 (7.9), `test/import-service.test.ts` 4.3 (5.1), `test/gpx-fixtures.test.ts` 1.2 (2.0), `test/oracle/tolerances.test.ts` 0.9 (1.5), `test/read-gp.test.ts` 0.7, `test/files-check/playback.test.ts` 0.6, `test/fixtures.test.ts` 0.5, `test/hand-built.test.ts` 0.4, `src/gpif/read-gpif.test.ts` 0.4; the other 19 under 0.4 s each.

`model` top ten: `src/commands/batched-effects.test.ts` 2.9 (4.6), `src/native.test.ts` 2.0, `src/history-memory.test.ts` 1.8 (3.0), `src/playback-sequence-property.test.ts` 1.1, `src/history-random.test.ts` 1.0, `src/commands/windowed-validation.test.ts` 1.0, `src/id.test.ts` 0.8, `src/large-score.test.ts` 0.8, `src/commands/chain.test.ts` 0.6, `src/commands/replace-beats.test.ts` 0.6; the other 21 under 0.4 s each.

`audio-node`: `src/test/signal.node.test.ts` 3.1, the other 16 under 0.5 s. `scripts`: `check-files/privacy.test.ts` 3.2 (4.2), `conflicts/check.test.ts` 0.7, the other 20 under 0.4 s. `desktop`: all 21 under 0.4 s. `layout-worker`: one file, 0.6 s.

Slowest single tests: two `attack-verification` cases (20.2 s and 17.3 s), three tuner-pipeline cases in `tracker.test.ts` (about 14 s each, each with its own 120 s sanity bound), the `cache-property` random-edit properties (4 to 13 s each, twelve of them), `sampler.test.ts` "starts every note of a burst" (10.6 s), `draft-cost` (9.8 s), `hq-memory-budget` (8.8 s), `budget.test.ts` continuous both (7.5 s).

### Bench (`pnpm bench`, one file at a time)

About 72 s inside the step: `layout.bench.ts` about 61 s (13 rows; the cold full layouts 4 to 9 s each), `effects.bench.ts` about 8 s, the two model benches about 1 s. It needs Chromium (the audio bench) and the soundfont, nothing the test step leaves behind.

### e2e (Playwright, one worker by design)

Per-test cost is the floor: 81 tests in about 318 s of test time (the log of run 44812232344, the one in-sample run with 81 tests, reports 5.5 minutes for the step; most in-sample runs had 62 to 77 tests), median about 3.4 s, and even trivial ones take 2 to 3 s (fresh context, `page.goto('/')`, app ready). Specs by median total (worst in brackets), from five runs:

| Spec                         | Median | Worst | | Spec                        | Median | Worst |
| ---------------------------- | ------ | ----- |-| --------------------------- | ------ | ----- |
| `player/transport.spec.ts`   | 23.5   | 24.0  | | `player/save.spec.ts`       | 10.0   | 10.7  |
| `player/seek.spec.ts`        | 18.3   | 19.1  | | `player/right-panel.spec.ts`| 10.0   | 10.6  |
| `player/follow.spec.ts`      | 17.9   | 18.3  | | `player/budgets.spec.ts`    | 8.6    | 9.7   |
| `editor/bar-structure.spec.ts` | 17.5 | 18.4  | | `editor/clipboard.spec.ts`  | 8.2    | 9.3   |
| `player/library.spec.ts`     | 14.2   | 16.3  | | `player/speed-trainer.spec.ts` | 6.9 | 7.2   |
| `player/fretboard.spec.ts`   | 14.2   | 14.5  | | `player/tuner.spec.ts`      | 6.1    | 6.4   |
| `player/practice-mode.spec.ts` | 14.0 | 14.0  | | `editor/note-entry.spec.ts` | 5.9    | 7.1   |
| `player/context-menu.spec.ts`| 13.9   | 14.7  | | `editor/round-trip.spec.ts` | 5.1    | 5.8   |
| `player/autosave.spec.ts`    | 13.8   | 15.4  | | `editor/words.spec.ts`      | 4.7    | 5.2   |
| `player/status-bar.spec.ts`  | 13.7   | 14.6  | | `editor/effects.spec.ts`    | 4.5    | 4.5   |
| `player/palette.spec.ts`     | 11.8   | 13.6  | | `editor/status-segments.spec.ts` | 4.2 | 4.9  |
| `player/open.spec.ts`        | 11.7   | 11.9  | | `editor/transpose.spec.ts`  | 4.1    | 4.6   |
| `player/mixer.spec.ts`       | 11.3   | 11.7  | | `editor/new-song.spec.ts`   | 3.7    | 3.9   |
| `player/header.spec.ts`      | 10.9   | 11.5  | | `editor/navigation.spec.ts` | 3.6    | 3.9   |
|                              |        |       | | `player/dock-shrink.spec.ts`, `export.spec.ts`, `settings.spec.ts` | 2.6 to 2.7 each | |

Slowest tests: `bar-structure` 17.5 s, `fretboard` 14.2 s, `transport` "tempo in BPM and percent" 12.3 s, `seek` loop drag 10.4 s, `follow` paged 9.9 s. No spec dominates; the cost is spread across 81 tests, and it grows by roughly 3.4 s per new test.

### Duplicated and wasted work

- Every job pays its own setup (about 28 s); the store, the browsers and the soundfont are already cached, and the build is 2 s, so there is little to share between jobs.
- `ci` installs the Chromium shell and `e2e` the full Chromium, under different cache keys (on purpose, see the comment in `ci.yml`).
- `release.yml` sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, but the root `postinstall` calls `playwright install chromium --only-shell` explicitly, so each package job downloads 104 MB of headless shell and FFmpeg it never uses (16 s on `mac-x64`). `bench-compare` also downloads it twice (head and `main`) with no browser cache, but it does use it: `effects.bench.ts`, a budgeted row, runs in the browser-mode `audio` project. Its double download is a cost to cache, not to remove.
- On a PR, `package (mac-x64)` builds both a DMG and a zip with block maps (about 80 s of its 125 s build) and uploads both (22 s); the smoke launches the app.

### The pre-commit hook

`lint-staged.config.js` runs `vitest related --run --no-fsModuleCache` on the staged TypeScript in every project except `audio` (which joins only when `packages/audio` is staged), then `tsc -b`. The browser-mode `web-browser` and `layout-worker` projects are not excluded, so any widely imported web file launches Chromium with real Web Audio: the tests most sensitive to a loaded Mac (#366).

Estimated selection for one staged file (static reverse-import closure; CI test time of the selected files, which a 14-core M4 Pro runs perhaps 2 to 4 times faster when idle):

| Staged file                                         | Test files selected                     | CI test time selected | Long poles                                          |
| --------------------------------------------------- | --------------------------------------- | --------------------- | --------------------------------------------------- |
| `apps/web/src/state/ui.ts`                          | 162 (146 web, 16 web-browser)           | 156 s                 | `budget.test.ts` 16, `playhead.browser` 9, `player.browser` 8 |
| `apps/web/src/state/settings.ts`                    | 166 (150 web, 16 web-browser)           | similar to `ui.ts`    | same                                                 |
| `apps/web/src/app/command-registry.ts`              | 135 (119 web, 16 web-browser)           | 133 s                 | `playhead.browser` 9, `player.browser` 8             |
| a leaf panel (`metronome-panel.tsx`)                | 134 (118 web, 16 web-browser)           | 133 s                 | same: it is reached from the app shell               |
| `apps/web/src/features/library/library-screen.tsx`  | not counted (web and 16 web-browser)    | 62 s                  | the browser files are 34 s of it                     |
| `packages/formats/src/gpif/xml.ts`                  | 182 (141 web, 21 formats, 18 web-browser; the other 2 are in projects not itemised) | 178 s               | `draft-cost.browser` 10                              |
| `packages/layout/src/layout.ts`                     | 215 (178 web, 19 layout, 17 web-browser; the other 1 is in a project not itemised, probably `layout-worker`) | 393 s                | `cache-property` 97, `layout.test` 42, `follow-long` 27 |
| any `packages/model` file                           | 336 of 447 (audio excluded: 297; the other 39 are `audio` files the static closure found, though every `audio` test imports the model, so all 45 run under the hook's rule and the real count is nearer 342)        | about 494 s           | `cache-property` 97, `tracker` 42, `layout.test` 42, `follow-long` 27 |

Two consequences. A model or layout commit is bounded below by `cache-property.test.ts` (one file runs in one worker), which no core count shortens. And because the app shell imports almost every feature, even a leaf component selects most of the web suite plus 16 Chromium files. CONTRIBUTING.md's measured "a one-file change in `packages/model` about five seconds" is far out of date.

## Options

Savings are wall-clock, estimated from the medians above. Size is scope (S, M, L). "Coverage" means: does the PR gate still run every test, project, budget and check it runs today.

### CI options

| #  | Option | Est. saving (mergeable, median) | Coverage / flakiness risk | Size | Depends on |
| -- | ------ | ------------------------------- | ------------------------- | ---- | ---------- |
| C1 | **Split the serial `ci` job into parallel jobs**: `static` (conflicts, lint, typecheck, format; ~135 s), `unit` (`pnpm test`), `bench` (alone on its runner, as now), `files` (fixtures, real-file pass, build, visual; ~85 s). A small aggregator job named `ci` `needs` all of them, runs `if: always()` and fails unless every result is `success`, so branch protection and `protect-main.sh` keep the name. | `ci` 549 s to ~290 s (the `unit` job); mergeable then waits on `e2e` (326 s): **~225 s** alone | None: the same commands run. Bench keeps a runner to itself. The aggregator must treat `skipped` and `cancelled` as failure. | M | none |
| C2 | **Split `pnpm test` across three runners by project group** (`vitest run --project ...` in a matrix): `web`; `layout`, `formats`, `model`, `audio-node`, `scripts`, `desktop`; `audio`, `web-browser`, `layout-worker`. A scripts test asserts every project in `vitest.config.ts` is in exactly one group, so a new project cannot fall out of CI. Groups are deterministic, unlike `--shard`, which splits by file count and would put `cache-property` anywhere. | `unit` ~290 s to ~150 to 170 s; with C1 and E1, **~125 s more** | None: same projects, same test count (summable from the three summaries). `--disable-audio-output` stays in `vitest.config.ts`. | S | C1 |
| E1 | **Shard `e2e` over three runners** (`playwright test --shard=i/3`, one worker each, so every runner still has the machine to itself), plus an `e2e` aggregator job so the name the lead watches stays. Upload the three blob reports and merge them only on failure. | `e2e` 326 s to ~140 to 160 s; with C1 and C2 the critical path becomes ~175 s | None: Playwright counts the tests per shard. Each shard rebuilds (2 s) and regenerates its scores (global setup). Shards balance by test count, not time: a bad split costs ~20 s. | S | none (pays only with C1 and C2) |
| R1 | **Make the root `postinstall` honour `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`**, so the `package (...)` jobs stop downloading a browser they never use. `pnpm bootstrap` and a plain local `pnpm install` keep downloading. `bench-compare` needs the headless shell for `effects.bench.ts`, and today gets it only from `postinstall` even though its two `pnpm install` steps set the variable, so with R1 it must either drop the variable or gain an explicit `playwright install chromium --only-shell` step, once and from a cache (both trees resolve the same Playwright version from the lockfile). | ~16 s on `package (mac-x64)`, a few seconds on the others; nothing on `bench-compare`, which keeps its download (and could cache it) | None | S | none |
| V1 | **Web project: create jsdom once per worker** with `pool: 'vmThreads'` (keeps per-file isolation). `isolate: false` is not recommended: module-level stores would leak between files and make order-dependent failures. | 115 to 205 s of worker time; ~25 to 50 s off the `web` group's wall, and the same share off every hook run that selects web tests | Medium: `vmThreads` has known caveats (memory growth, `instanceof` across contexts, some native modules). Must be measured over several runs before adoption; any test that needs real isolation stays in `forks`. | S to try, M if tests need fixes | none |
| T1 | **Split the long files** so they parallelise: `cache-property.test.ts` by notation (four files), `layout.test.ts` long-score cases from the rest and split until no file is over about 30 s, `attack-verification.test.ts` per fixture, each of the three tuner pipeline cases (about 14 s each) in its own file, out of `tracker.test.ts` (42 s as one file), `follow-long.test.tsx` by view. Same tests, same assertions. | CI: better balance for C2 (~10 to 20 s). Pre-push hook (H3): the 97 s floor of a model or layout run drops to ~30 s, which holds only if no resulting file is over ~30 s: one file per pipeline case, `cache-property` in four, the layout long-score cases split as above | None | S | none |
| R2 | On PR runs, package only `mac-arm64` and `windows-x64` and drop the `package (mac-x64)` job. Tags and `workflow_dispatch` keep all three; since `release.yml` has no `push` to `main` trigger today, a `push: branches: [main]` trigger is added so the Intel build still runs after every merge. (A different cut, not taken: keep all three architectures on PRs but build one installer format and skip the upload, about 40 s of the 125 s build and 22 s of upload on `mac-x64`.) | The whole `package (mac-x64)` job, ~263 s, leaves PR runs. The release wall goes from ~278 s to the `gate` plus the slower of the two remaining jobs (161 s and 169 s), about 180 s, close to the ~175 s `ci`/`e2e` critical path after C1, C2 and E1, so desktop PRs stop waiting on mac-x64 | Medium: AGENTS.md calls these jobs the only run of the packaged app on Windows and Intel macOS, so an Intel-only break (a native module, the x64 DMG or zip, the smoke on Intel) would first show on `main` after the merge, or on a tag or dispatch, not on the PR. The new `main` trigger bounds that to one merge. The owner's rule that a red `package` blocks the merge stays, but it checks one architecture less. | S | none |
| B1 | **`bench-compare`: one runner per bench file** (layout on one, the model and audio benches on another). Each row is still compared base against head on the same runner, alternating, five rounds. | ~460 s to ~300 s when it runs (2 of 17 PR runs today). Matters once it becomes required, when it would be the critical path | Low: the pairing that makes the comparison fair is per row, and stays | S to M | none |
| L1 | ESLint `--concurrency auto` (ESLint 9.34 and later). Typed linting builds a TypeScript program per worker, so the gain on 4 vCPU must be measured. ESLint `--cache` is not recommended: it keys on each file's own content, so a type change elsewhere would not re-lint it. | 72 s to maybe 40 s, but off the critical path after C1 | Low | S | C1 |
| E2 | Look for per-test setup cost in e2e (2 to 3 s even for trivial tests): whether each fresh context refetches the GM bank (32 MB) or regenerates anything on load. Sharing a page across tests is not recommended: it trades isolation for speed. | unknown until measured; each 0.5 s saved per test is ~40 s of `e2e` | Low if it is only caching | S to investigate | none |

Moving heavy tests to a scheduled job is not proposed: every slow file guards something the PR gate catches today (cache equivalence, attack verification, the tuner pipeline, the render budgets).

### Local hook options

| #  | Option | Est. saving per commit | Risk | Size | Depends on |
| -- | ------ | ---------------------- | ---- | ---- | ---------- |
| H1 | **Leave the browser-mode projects out of the hook** (`--project=!web-browser --project=!layout-worker`, as `audio` already is), and let them join only when a staged file is a `*.browser.test.*` file or lives under `packages/layout/test/`. CI still runs them on every PR. | ~40 to 50 s of test time plus a Chromium launch on any web commit that reaches the app shell; removes the Web Audio tests that hang when coreaudiod stalls (#366) | Weaker local gate: a browser-test regression from a web source change shows up on the PR instead, one round trip later | S | owner's pick (CONTRIBUTING.md rule changes) |
| H2 | **Leave named heavy files out of the hook** (`cache-property`, `tracker` pipeline, `follow-long`, `budget`, `attack-verification`, the long-score layout cases), through a `*.slow.test.ts` naming convention and `--exclude` in `lint-staged.config.js`. CI runs them. | about 250 s of test time on a model commit; ~16 s on a `ui.ts` commit | Weaker local gate for exactly the tests most likely to time out under load; needs a rule for when a file is "slow" (for example over 10 s of CI test time) | S to M | T1 helps; owner's pick |
| H3 | **Move `vitest related` from pre-commit to pre-push**, over the files changed since the upstream branch (or `origin/main`). The commit hook keeps the conflict check, ESLint, Prettier and `tsc -b`, which take seconds. | every commit but the last before a push stops running tests: an implementer making five commits runs the related set once instead of five times | Commits in the middle of a branch may be red; they are squashed at merge, so `main` is unaffected. The push still runs the gate before CI sees the branch | S | owner's pick; CONTRIBUTING.md and AGENTS.md updated |
| H4 | Cap the hook's workers (`--maxWorkers=50%`) when several agents share the Mac | none, possibly slower when idle; fewer timeouts when loaded | Low | S | none |
| H5 | Refresh the measured timings in CONTRIBUTING.md (the "five seconds" for a model change) once the above land | none; stops the hook from being judged against a wrong baseline | None | S | after H1 to H3 |
| T1 | (from the CI list) splitting the long files is the biggest hook win that weakens nothing | the 97 s floor of a model or layout push drops to ~30 s on many cores (each tuner pipeline case in its own file; splitting them together would leave a 42 s file) | None | S | none |
| V1 | (from the CI list) jsdom once per worker | ~27% of the web share of each hook run | Medium, as above | S | none |

### Ranked by saving per risk

| Rank | Option | Where | Saving | Risk | Size | Quick win |
| ---- | ------ | ----- | ------ | ---- | ---- | --------- |
| 1 | C1 parallel jobs and a `ci` aggregator | CI | ~225 s alone, the base for the rest | none | M | yes |
| 2 | E1 shard `e2e` ×3 and an `e2e` aggregator | CI | with C1 and C2: mergeable ~551 s to ~175 s | none | S | yes |
| 3 | C2 `pnpm test` in three project groups, with the coverage guard | CI | ~125 s more | none | S | yes |
| 4 | T1 split the long test files | both | pre-push floor ~97 s to ~30 s; CI balance | none | S | yes |
| 5 | H1 browser projects out of the hook | hook | ~40 to 50 s per web commit, and the hang | local gate weaker | S | owner's pick |
| 6 | R1 `postinstall` honours the skip variable | CI | ~16 s on `package (mac-x64)` | none | S | yes |
| 7 | H3 related tests on pre-push | hook | all but one run per push | intermediate commits may be red | S | owner's pick |
| 8 | V1 `vmThreads` for `web` | both | ~25 to 50 s CI, ~27% of web hook time | medium | S to M | no: measure first |
| 9 | B1 split `bench-compare` per bench file | CI | ~160 s when it runs | low | S to M | when it becomes required |
| 10 | R2 no `package (mac-x64)` on PR runs, plus a `main` push trigger | CI | ~263 s job gone; release wall ~278 s to ~180 s on desktop PRs | medium | S | owner's pick |
| 11 | H2 heavy files out of the hook | hook | ~250 s per model commit | local gate weaker | S to M | owner's pick |
| 12 | L1 ESLint concurrency | CI | off the critical path | low | S | no |
| 13 | E2 e2e per-test setup | CI | unknown | low | S | investigate |
| 14 | H4 cap hook workers | hook | none (stability) | low | S | optional |

**Safe quick wins the owner can approve as a batch** (no lost coverage, no weaker gate): C1, C2, E1, T1, R1. Together they bring the median wait for a mergeable PR from about 9 minutes (p90 11.5) to about 3 minutes, where the mac-x64 packaging job (median 4.4 minutes) becomes the longest wait on PRs that touch the desktop build, and they take the floor of a related-test run on model and layout changes (the pre-push hook, H3) from about 97 s of one file down to about 30 s.

**Owner's picks** (each weakens the local gate or what PRs check, and changes a CONTRIBUTING.md rule): H1, H3, H2, R2. Taken on 2026-11-20: H3 and R2; H1 and H2 were not (see the Conclusion).

## Conclusion

What the owner decided on 2026-11-20 (#379), and which work picks it up:

- **Safe batch, all taken**: C1, C2, E1, T1 and R1.
- **Hook: H3.** `vitest related` moves from pre-commit to pre-push; the commit hook keeps the conflict check, ESLint, Prettier and `tsc -b`. H1 and H2 were not taken. H5 (refresh the hook timings in CONTRIBUTING.md) lands in the same PR as H3, with the CONTRIBUTING.md and AGENTS.md rule changes.
- **R2: yes**, read as no `package (mac-x64)` on PR runs, with a `push: branches: [main]` trigger added to `release.yml` so mac-x64 still runs after a merge (it also runs on tags and dispatch). See the R2 row for the saving and the risk.
- **Not taken, measured later**: V1 (`vmThreads` for `web`), B1 before `bench-compare` becomes required, and E2. L1 and H4 were not picked.

The work is three PRs, each reporting before and after wall time over several runs against the baseline in the appendix, with the test counts that show coverage held:

1. **`ci: run the ci and e2e checks as parallel jobs`** (#381, part 1): C1, C2 and E1. `ci.yml`, a scripts test that every Vitest project is in exactly one group, AGENTS.md and the comment in `protect-main.sh`, the player e2e README; the required check stays `ci`.
2. **Part 2: hooks, `postinstall` and `release.yml`**: H3, H5, R1 and R2. In progress on branch `chore/379-hooks-release`; no PR is open yet. R1 must keep the headless shell for `bench-compare` (explicit `playwright install chromium --only-shell` step from a cache, or drop the skip variable there), because `effects.bench.ts` needs it.
3. **Part 3: `test`: split the long test files** (T1): `cache-property`, `layout.test`, `attack-verification`, `tracker` (each pipeline case in its own file), `follow-long`; same test count per project.

## Appendix: the sample

The 24 `ci.yml` runs (all `status=success`, attempt 1, created 2026-11-20 between 11:12:57 and 20:32:07 UTC; `gh api "repos/tomer-shvadron/reprise/actions/workflows/ci.yml/runs?created=2026-11-20&status=success&per_page=100"`, keep `created_at` before 20:33 UTC, take the last 24 by creation time):

44725746285, 44727107952, 44727612270, 44728325021, 44732969494, 44737845768, 44739397307, 44741033960, 44741639837, 44742421376, 44742862245, 44743642522, 44744312197, 44744880371, 44745929285, 44748693524, 44748849031, 44750359971, 44750426441, 44750832275, 44804447882, 44808616453, 44810200331, 44812232344.

The API returns 44 such runs; the 20 older ones (44644404315 to 44722181120 and 44725607492) are not in the sample. Rebuilding the tables from these 24 gives the medians, p90s and worsts in the job table. The `e2e` test count in them is 62 (five runs), 63, 68 (four), 69, 74 (three), 75 (eight), 77 and 81.

The 12 `release.yml` PR runs: 44644853518, 44645145213, 44648589549, 44713232804 (cancelled, not timed), 44713294560, 44717138541, 44718795131, 44722181457, 44725746300, 44744880325, 44810199837, 44812575748.

The ten job logs behind the per-test and per-file tables (five `ci`, five `e2e`) are not identified: their run IDs were not written down, and the run list cannot say which were opened. The per-file figures are medians and worsts over those five logs and move by the runner spread (a few seconds on the small files, 15 to 25% on the large ones). A PR that reports a before and after for one of these tests should take its own five-run baseline from the runs above, with the log of each run's `Test` and `E2E` steps, rather than rely on the tables in this note.

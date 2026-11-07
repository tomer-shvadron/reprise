# Visual regression of the score painter

Pixel screenshots of `ScorePage` (from `@/features/score`) in Vitest browser mode, on the
Playwright Chromium headless shell the `audio` project already uses. Each scene is laid out with
`layout()` and `viewLayoutOptions()`, painted at zoom 1, cropped to its systems, and compared with
a committed baseline. Structure is tested elsewhere, by the layout package's data snapshots; this
suite catches what data cannot show: glyph and font rendering, the CSS tokens, paper knockouts,
collisions, and how the tab and standard staves draw the same music side by side.

```sh
pnpm test:visual              # locally: compare against your own references in __local__/
pnpm test:visual --update     # rewrite your own references (never committed)
pnpm visual:accept [run-id]   # take a failed CI run's images as the new baselines
```

The suite has its own config, `apps/web/vitest.visual.config.ts`, so `pnpm test`, `vitest related`
and the pre-commit hook never run it. CI runs it in the **Visual** step.

## Baselines come from CI only

Linux and macOS rasterize text differently, so only CI's images are committed:
`__screenshots__/score.visual.test.tsx/<scene>-<notation>[-p<page>]-<theme>-chromium-linux.png`.
CI (`GITHUB_ACTIONS=true`) is the only run that reads them.

Every other run, on macOS or anywhere else, compares against your own references in
`e2e/visual/__local__/score.visual.test.tsx/`, which is gitignored. The config's
`resolveScreenshotPath` sends local runs there, so a local run never reads the committed baselines
and `--update` on a Linux machine cannot overwrite them. To check a change locally:

1. On the base commit, run `pnpm test:visual`. The first run has no references, so it creates
   `__local__/` and writes one per scene, and every test fails with "a new one was created". That
   failure means nothing yet: it is not a check. `pnpm test:visual --update` rewrites the
   references when they are stale.
2. Switch to your change and run `pnpm test:visual` again. It now compares, and the diffs land
   in `apps/web/.vitest/attachments/`.

A local pass says only that your change did not move pixels on your machine; CI's Visual step is
what checks the committed baselines.

When a PR changes pixels on purpose:

1. Push. CI's Visual step fails and uploads the `visual-diff` artifact: each failing scene's
   actual and diff images (red marks counted pixels, yellow the anti-aliasing that was ignored),
   and a reference image for any missing baseline.
2. Look at the diffs. Never accept one you cannot explain.
3. `export GH_TOKEN="$(gh auth token --user tomer-shvadron)"`, then `pnpm visual:accept` (the
   latest `ci.yml` run of `HEAD`, or a run id). It copies the actual and reference images over the
   baselines and lists them.
4. Open the accepted PNGs, commit them, and say in the PR which scenes changed and why. The
   review sees them in Files changed with GitHub's 2-up, swipe and onion-skin views.

When a scene is renamed or dropped, `git rm` its old baselines: on CI the suite fails after its
tests on any committed baseline that no scene captures, and `visual:accept` refuses such a run.

A Playwright bump that changes Chromium re-accepts every baseline in its own PR.

## Tolerance

Set once in the config, never per test, with no retries: pixelmatch with `threshold: 0.1` (the
per-pixel YIQ distance; ink on paper is far above it), `includeAA: false` (anti-aliased edge pixels
are not counted) and at most 10 differing pixels per image. Baselines and checks run in the same CI
environment, so the expected difference is zero; moving a stem by 2 px changes about 40 counted
pixels. One theme is enough for most scenes, since the two papers differ by less than the
threshold; `rhythm-values-both` is also captured in light, to catch a light-token regression.

Every test first asserts that every Bravura and Geist face is loaded (the app falls back quietly
when a font fails), and that the page fits the 1600 × 2000 viewport, so a clipped capture fails.

## Scenes

Builder scenes are in `test/scenes.ts`, built with `{ ids: 'sequential' }`; the reference set
comes from the corpus. A guard on a scene asserts on the layout before painting, proving the scene
shows what it claims; when one fails, change the scene, not the guard.

| Scene               | Source                    | Notations           |
| ------------------- | ------------------------- | ------------------- |
| `rhythm-values`     | builder                   | tab, standard, both |
| `meters`            | builder                   | tab, standard       |
| `tuplets-ties`      | builder, 400 px wide      | tab, standard, both |
| `voices`            | builder                   | tab, standard, both |
| `words`             | builder                   | tab, standard, both |
| `pitch-accidentals` | builder                   | standard, both      |
| `tab-notes`         | builder                   | tab                 |
| `furniture`         | builder                   | default             |
| `continuous`        | `rhythm-values`           | both                |
| `effects`           | `gp5/effects.gp5`         | tab, standard, both |
| `multivoice`        | `gp/multivoice-rhythm.gp` | tab, standard, both |
| `drums`             | `gp/drum-tabs.gp`         | default             |
| `percussion-all`    | `gp5/percussion-all.gp5`  | default             |
| `pitched`           | `gp/sustain.gp`           | default             |
| `long`              | `longScore()`, pages 0, 1 | default             |

## Size budget

`scripts/visual/baselines.test.ts`, part of `pnpm test`, checks the tracked baselines: Linux names
only, each file at most 512 KB, 5 MB in all, each image at most 1600 × 2000 px. An image over
budget gets cropped tighter or its scene made smaller; the budget is not raised in the same PR.

## Print to PDF

`print.visual.test.tsx` checks printing end to end. A global setup (`test/demo-server.node.ts`) starts a Vite server for `apps/web`, and the `printPdf` browser command (`test/print-pdf.node.ts`, run in Node) opens the demo's `view=print` in a page of its own, records each page box in print media, and prints it with `page.pdf({ preferCSSPageSize: true })` to `apps/web/.vitest/print/<name>.pdf`. For `gp5/effects.gp5` (both), `gp5/key-signatures.gp5` (standard) and `gp/drum-tabs.gp` on A4 and Letter, and the long score on A4, every PDF must have exactly the print layout's page count (`test/pdf-pages.node.ts` reads the page objects), each MediaBox the paper in points, and no system across a sheet edge. CI uploads the folder as the `print-pdfs` artifact. The same file captures page 1 of `PrintDocument preview` under the dark theme on each paper (`print-effects-both-<paper>-p0-dark`). `*.node.ts` files are compiled by `tsconfig.node.json`, not the browser project.

# ADR-0023: Visual regression in Vitest browser mode

- **Status**: Accepted
- **Date**: 2026-11-06
- **Deciders**: the lead's ruling on #32, which the owner can overrule

## Context

ADR-0015 says the layout's reference scores are "rendered to SVG and compared as images in
Playwright", and its Consequences say "the image comparison and e2e suites run under
Playwright". WP-026 (#32) builds that image comparison. The plan on #32 proposed running it as a
Vitest project in browser mode rather than as a Playwright test suite, and the lead accepted it
(ruling 2 on #32), with a short ADR superseding ADR-0015's line if that line names Playwright for
visual regression. It does.

Vitest browser mode already drives the Playwright Chromium headless shell for the `audio` and
`web-browser` projects, in CI and locally, and it has a screenshot matcher with diff images and
`--update` built in. A Playwright test runner would be a second runner, a second config and a
second way of loading the app's code for one suite.

## Decision

It supersedes the image-comparison half of ADR-0015's Layout bullet and Consequences line; the
rest of ADR-0015 stands, the Playwright end-to-end suite against the Electron build included.

- **The layout's pixel regression is a Vitest project in browser mode**, `visual`, with its own
  config (`apps/web/vitest.visual.config.ts`) so that `pnpm test` and the pre-commit hook never
  run it. Playwright only drives the Chromium headless shell.
- **It paints the score painter's `ScorePage`** from `layout()` output, not a demo route, and
  compares each capture with `toMatchScreenshot`.
- **The committed baselines are CI's Linux images**, accepted from a failed CI run with
  `pnpm visual:accept`, on a pinned runner image with grayscale text. A local run compares
  against the developer's own references in a gitignored folder, never against the committed
  baselines.

## Alternatives considered

- **A Playwright test suite (`@playwright/test`) against a demo route**, as ADR-0015 read
  literally: a second test runner and config, and a route that exists only for tests. Rejected
  in the plan on #32.
- **Committing each platform's baselines**: macOS and Linux rasterize text differently, so every
  intended change would need two sets of images made on two machines. Rejected.

## Consequences

- `pnpm test:visual` runs the suite; CI runs it in its **Visual** step after the build and
  uploads the diffs when it fails. `apps/web/e2e/visual/README.md` holds the procedure.
- A Playwright or runner-image bump that moves pixels re-accepts every baseline in its own PR.

## Related

- `0015-testing-strategy.md`
- `../plans/phase-2-lanes-to-player.md` (WP-026)

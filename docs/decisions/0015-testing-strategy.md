# ADR-0015: Testing that fits a notation and audio app

- **Status**: Accepted, superseded in part by [ADR-0023](0023-visual-regression-in-vitest-browser-mode.md) (the image comparison runs in Vitest browser mode)
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The owner's other repositories run unit, end-to-end, coverage and Lighthouse checks. Plain
unit tests miss the bugs that matter in this app: a stem two pixels off, a note starting late,
a bend ending on the wrong pitch, a file that reads back differently. Copyrighted tabs cannot
be committed as fixtures. Memory and layout performance are stated priorities.

## Decision

- **Model and formats**: unit tests plus round-trip tests: read a file, write native, read
  again, assert identical. alphaTab is a **dev-only** dependency used as an independent
  oracle: the same file parsed by both and compared at note level; our gp writer's output
  read back by alphaTab.
- **Layout**: snapshot tests of the layout output, which is plain data with readable diffs;
  plus a small set of reference scores rendered to SVG and compared as images in Playwright
  to catch pixel-level regressions.
- **Audio**: the scheduler and sampler tested against an `OfflineAudioContext`, which
  renders deterministically with no speakers: a note starts at the expected sample offset, a
  bend ends on the right pitch, eviction frees what it should.
- **App**: Playwright end-to-end against the Electron build for the core flows: open a file,
  play, loop, edit a note, save, print preview.
- **Fixtures**: no copyrighted tabs in the repository. Test files are hand-written, generated
  by our own writer, or taken from alphaTab's and TuxGuitar's open test data. Downloaded tabs
  live in a gitignored local folder and are used only for manual testing.
- **Performance**: a benchmark test opens a long eight-track score and asserts layout time
  and memory stay under budgets set in the repository. Runs in CI and fails on regression.

## Alternatives considered

- **Unit tests only**: rejected; they do not catch the classes of bug above.
- **Committing real tabs as fixtures**: rejected on licensing grounds.
- **alphaTab as a runtime dependency**: rejected in ADR-0002; as an oracle it costs nothing
  at runtime.

## Consequences

- Each package has its own test suite under Vitest projects; the image comparison and e2e
  suites run under Playwright.
- The fixture set has to be curated early, during the foundation milestone, because every
  lane needs it.
- Performance budgets are numbers in the repository, revised deliberately rather than
  silently.

## Related

- `../specs/shared-understanding.md`
- `0002-hybrid-build-vs-assemble.md`
- `0005-memory-budgets-lazy-loading.md`
- `0010-svg-renderer-virtualized.md`

# ADR-0007: Per-track notation toggle, rhythm stems under tab always

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

Guitar Pro's default shows a standard-notation staff with the tab staff below it, and draws
rhythm stems and beams under the tab numbers. Most guitarists read the tab and ignore the top
staff. With a standard-notation engine already in scope because of ADR-0006, offering it for
guitar tracks costs little.

## Decision

- Each track has a display mode: **tab**, **standard**, or **both**, toggled from the track
  header.
- The default is **tab for fretted instruments** and **standard for everything else**. Drums
  always use the percussion staff.
- **Rhythm stems, beams and flags are drawn under the tab in every mode.** A tab without
  timing information is unplayable, so this is not optional.

## Alternatives considered

- **Tab only with rhythm stems**: compact and how most people read Guitar Pro, but it throws
  away the sight-reading option that is nearly free. Rejected.
- **Tab plus standard always**, Guitar Pro's default: twice the vertical space for a staff
  most users ignore. Rejected as the default, available as a mode.

## Consequences

- The layout engine composes a track's staves from the mode: a tab staff, a standard staff,
  or both stacked, sharing one horizontal spacing so beats align vertically.
- The toggle is persisted per track in the native file and per song in the library.
- Printing honours the current mode.

## Related

- `../specs/shared-understanding.md`
- `0006-score-model-scope.md`
- `0010-svg-renderer-virtualized.md`

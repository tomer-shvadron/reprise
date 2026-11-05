# ADR-0005: Memory is a first-class requirement

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The owner stated that memory management is very important: evicting unnecessary data and
lazy loading only the instrument sounds a song needs. Decoded audio is the dominant cost. A
high-quality multi-velocity sampled guitar can reach hundreds of megabytes decoded if loaded
whole; a 44.1 kHz mono sample decodes to roughly 176 KB per second. Electron adds an idle
baseline of its own before any score data.

The layout engine is the other place a long multi-track score can cost memory and time.

## Decision

- **Lazy decode per region.** A sample is fetched and decoded the first time a region that
  uses it is needed, not when its instrument or pack is opened.
- **Load only what the current song uses.** The set of instruments (and, for HQ packs, the
  articulation layers) is derived from the score; nothing else is loaded.
- **LRU eviction under an explicit budget.** Decoded audio buffers live in a cache with a
  budget, initially 300 MB (default unless revisited), tunable in settings. Eviction is
  least-recently-used, and switching songs evicts what the new song does not use.
- **Soundfont practice over full multisampling.** Where a pack provides it, one sample every
  few semitones with pitch shifting, rather than every fret of every string.
- **Budgets are tested, not hoped for.** A benchmark test opens a long eight-track reference
  score and asserts that layout time and memory stay under budgets set in the repo. It runs
  in CI and fails on regression. See `0015-testing-strategy.md`.
- **Memory statistics are observable** from inside the app, so the budget can be tuned
  against real packs.

## Alternatives considered

- **Load whole soundfonts or packs up front**: simplest, and the reason a borrowed
  synthesizer was rejected in ADR-0004. Rejected.
- **No explicit budget, rely on the garbage collector**: decoded `AudioBuffer`s are large and
  long-lived; without an owner-controlled cache there is no eviction point. Rejected.

## Consequences

- The sampler's region map must separate metadata (always resident, small) from sample data
  (resident on demand), which shapes both loaders.
- First playback of an instrument in a session can have a short load before sound; the
  scheduler's lookahead and a pre-warm of the instruments in the current song at load time
  hide this in practice.
- The budget number is a starting point; tuning it against real HQ packs is expected work in
  the HQ sound checkpoint.

## Related

- `../specs/shared-understanding.md`
- `0003-desktop-only-electron.md`
- `0004-own-sampler-engine-two-loaders.md`
- `0015-testing-strategy.md`

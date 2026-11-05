# ADR-0002: Build the core, borrow the commodities

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

An open-source library, alphaTab, already does most of a Guitar Pro player: it parses
gp3/gp4/gp5/gpx/gp files, renders tab and standard notation to SVG, and plays scores back
with a built-in soundfont synthesizer. It does not do editing, and it owns both the data
model and the renderer.

The project could wrap alphaTab and be a UI shell, build everything from scratch, or own the
pieces that matter and borrow the rest. The owner's previous hobby projects show a preference
for owning the core and polishing it with tests and performance tooling.

## Decision

Hybrid. Reprise owns:

- the score data model,
- the layout engine and the renderer,
- the sampler and playback scheduler,
- the Guitar Pro file readers and the gp writer.

Reprise borrows, as libraries, fonts or data:

- parsing of SF2 and SFZ soundfont files,
- audio decoders (the browser's `decodeAudioData`),
- the sound data itself (soundfonts, sample libraries, impulse responses),
- the Bravura SMuFL font for notation glyphs,
- zip and XML handling.

alphaTab is not a runtime dependency. It is a dev-only dependency used as an independent
oracle in tests: the same file parsed by both, compared at note level, and our gp writer's
output read back by it. See `0015-testing-strategy.md`.

## Alternatives considered

- **Assemble: wrap alphaTab**: a working player in a very short time, but the editor would
  fight the library's ownership of the model and renderer the whole way. Rejected.
- **Build from scratch, including the parsers and the synth**: every piece ours, but binary
  file parsing and realistic sound synthesis are commodity problems with no fun in them, and
  they would delay the first usable build. Rejected.

## Consequences

- Owning the model is what makes the editor fit naturally; owning the renderer is what makes
  the display the product's own.
- The borrowed pieces are chosen so they can be replaced: a loader produces an in-memory
  region map (`0004-own-sampler-engine-two-loaders.md`), the painter consumes positioned
  glyphs (`0010-svg-renderer-virtualized.md`).
- An earlier suggestion in the session, to borrow the sampler too, was reversed once the
  per-voice pitch and memory-eviction requirements were understood. That reversal is the
  subject of ADR-0004.

## Related

- `../specs/shared-understanding.md`
- `0004-own-sampler-engine-two-loaders.md`
- `0010-svg-renderer-virtualized.md`
- `0015-testing-strategy.md`

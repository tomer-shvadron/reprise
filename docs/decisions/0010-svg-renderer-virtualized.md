# ADR-0010: SVG painter with virtualized systems and geometry-based hit-testing

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The layout package outputs positioned glyphs; something has to paint them, the editor has to
know what was clicked, and printing was moved into v1 by the owner. SVG gives crisp output at
every zoom and near-free printing through print CSS, but slows down past a few tens of
thousands of DOM elements, which a long multi-track score can reach. Canvas paints anything
at any size but is blurry on zoom unless redrawn, needs a separate print path, and needs its
own hit-testing.

## Decision

- **SVG is the painter.** One element per glyph, drawn from the layout output.
- **Systems are virtualized.** Only the systems in or near the viewport exist in the DOM, so
  the element count is bounded regardless of score length.
- **Hit-testing uses layout geometry, not DOM events.** Every positioned primitive carries the
  ID of the model node it represents and a bounding box; clicks are resolved against that
  data. The editor therefore does not depend on which elements happen to be mounted.
- **Notation glyphs come from Bravura**, the SIL-licensed SMuFL font used by MuseScore and
  Dorico. Clefs, note heads, rests, accidentals and articulation symbols are never drawn by
  hand. Tab numbers and text use a regular UI font.
- **Printing** uses a print stylesheet over the paged layout at paper size.

## Alternatives considered

- **Canvas**: rejected for v1 because of printing and hit-testing costs. The decision to keep
  hit-testing geometry-based means switching the painter to Canvas later would touch one
  package and nothing else.
- **SVG without virtualization**: rejected; the element count would not be bounded.

## Consequences

- The layout output format must include node IDs and bounding boxes on every primitive, and
  a system-level index for virtualization.
- Playback cursor and selection highlighting are overlays positioned from the same geometry.
- Zoom is a transform of the layout at a chosen scale; the layout is recomputed on width
  changes, which is what paged versus continuous view and window resizing require.
- Bravura's font metrics are needed by the layout package for glyph widths; they are loaded
  as a metrics table so layout never touches the DOM.

## Related

- `../specs/shared-understanding.md`
- `0007-notation-display-modes.md`
- `0009-monorepo-pnpm-workspaces.md`
- `0015-testing-strategy.md`

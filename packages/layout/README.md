# @reprise/layout

Turns a `Score` into positioned primitives and hit-testing geometry. Pure TypeScript: it imports `@reprise/model` and nothing else, touches no DOM, and measures text and glyphs from metrics tables committed beside the source. The contract it implements is "Layout" in [`docs/specs/architecture.md`](../../docs/specs/architecture.md); the engraving rules it follows are in [`docs/reference/notation.md`](../../docs/reference/notation.md).

```ts
import { LayoutCache, PAGE_SIZES, hitTest, layout } from '@reprise/layout';

const cache = new LayoutCache();
const result = layout(
  score,
  { mode: 'paged', width: PAGE_SIZES.a4.width, zoom: 1, tracks: 'all', notation: {} },
  cache,
);
const hit = hitTest(result, x, y); // { kind: 'beat', id, bbox, ... } | undefined

// after an edit
const { score: next, change } = applyCommand(score, command);
const updated = layout(next, { ...options, dirtyBars: change.touchedBars }, cache);
```

## Coordinates and units

- **CSS px, y down.** The origin is the top left corner of the first page. In paged mode the pages stack vertically, `pageGap` (32 px) apart, and each `Page.bbox` says where its page sits, so a print view subtracts `page.bbox.y` to get page-relative coordinates. Continuous mode has one page as wide and tall as its content.
- **Staff space.** Notation is sized in staff spaces, the distance between two lines of a five-line staff: `STAFF_SPACE` (7 px) times `zoom`. Glyph metrics are in staff spaces, as SMuFL defines them; a glyph primitive's `size` is its font size, four staff spaces.
- **`zoom` scales the notation, not the paper.** Staff space, text and the staff, track and system gaps scale with it; `width`, `pageHeight`, the margins and `pageGap` are taken as given. A higher zoom therefore fits fewer bars on a line. The painter's own zoom transform is separate (WP-024).
- **Rounding.** Every coordinate is rounded to 1/100 px when it is emitted, so results serialise compactly and compare exactly.

## API

`layout(score, options, cache?)` returns `{ pages, systems, primitives, anchors, metrics }`:

- **`LayoutOptions`** is the contract's `{ mode, width, pageHeight?, zoom, tracks, notation }` plus optional `margins` (48 px a side paged, 16 continuous), `pageGap`, `staffGap` (12), `trackGap` (24), `systemGap` (32) and `dirtyBars`. `pageHeight` defaults to A4; `PAGE_SIZES` holds A4 and Letter at 96 dpi. `notation` overrides a track's `display.notation` by track id.
- **`Primitive`** is `glyph` (a Bravura glyph: SMuFL name, codepoint, font size; `x, y` the glyph origin on its baseline), `line` (`x, y` to `x2, y2`, a thickness, an optional dash), `path` (SVG path data in layout coordinates, filled or stroked) or `text` (UI font; `x, y` the baseline point `anchor` refers to). Each has a `bbox`, a theme `role` (`ink`, `paper`, `accent`, `muted`; everything in this package is `ink`) and, where it draws one model node, that node's id in `node`.
- **`Anchor`** maps a model node to its hit box: `note` (from WP-021 and WP-023), `beat` (one per beat, voice and staff), `bar` (one per track bar, carrying `track`, and one per master bar for the whole column, without), `staff` (keyed by track id, one per staff and system) and `system` (keyed by the system id). Within one system, kind, track, staff and voice, anchors never overlap; the tests assert it.
- **`System`** has a stable `id` (`system:<first master-bar id>`), its page, its master-bar range, its box, its staves' line positions, and the ranges of `primitives` and `anchors` that belong to it: both arrays are ordered by system, so a painter virtualizes by slicing them.
- **`Page`** has its box and its range of systems.
- **`metrics`** has `layoutMs` (wall clock, the one field that differs between identical calls), the primitive and anchor counts, `measuredBars` and `reusedSystems`.
- `hitTest(result, x, y)` returns the most specific anchor under the point: by kind (note, beat, bar, staff, system), then a track's bar over the master bar's column, then the smallest. It only searches systems whose box holds the point.

## How a layout is made

1. **Options** resolve to the visible tracks and the staves each shows: tab, standard, or standard above tab for `both`. Drum tracks always get a percussion staff, and a track without strings falls back from tab to standard.
2. **Context.** For every master bar: the clef in effect on each track (`Bar.clef` holds until the next bar that sets one), and whether the time signature or key changes there.
3. **Measure** (`measure.ts`), once per master bar across every visible staff: the onsets of every beat in every visible voice, merged so tracks and voices align; one spring per onset, whose natural width is the Gourlay-style duration width (`spacing.ts`: a 64th is 1 staff space and each doubling adds 0.7) scaled by how much of the shortest beat starting there the gap covers, and whose minimum is the room the staff modules ask for either side of the onsets; and the fixed parts (clef and key changes, time signature, start repeat, padding, end bar line). An anacrusis spans what it holds, not its time signature. Header markings (tempo, section, jumps) widen a bar that is too narrow for them.
4. **Break** (`breaking.ts`): greedy, bar by bar against the width left after the track names and the line's clefs and key, always at least one bar, so a bar wider than the page overflows rather than splitting. Paged systems are then stretched to the right margin, all but a last one under three quarters full; stretching scales the springs and never goes below their minimums.
5. **Stack** (`vertical.ts`): header bands for sections, tempo, jumps and targets, and voltas, only when a bar of the system has one; then each track's staves with the room their bars ask for above and below, `staffGap` within a track and `trackGap` between tracks. Paged systems flow down the pages, a new page when the next would cross the bottom margin.
6. **Draw** (`render.ts`, `furniture.ts`, `header.ts`): track names, staff lines, the line's opening bar line, clefs and key signatures, then per bar its signature changes (a key change cancelling the old key with naturals), the staff module's content, bar lines and header markings, the courtesy signatures at a paged system's end, and the anchors.

### Continuous mode

One line, natural widths. It is still cut into systems: consecutive segments of about `width` px, side by side on one page, so the painter can virtualize a long line the same way it virtualizes pages. Only the first segment carries track names, clefs and key; the others continue the staff seamlessly. All segments share the vertical layout of the whole line.

## Staff modules

The engine owns spacing, breaking, stacking and the furniture every staff shares. What a staff type draws inside a bar comes from a `StaffModule` (`src/staves/staff-module.ts`), registered by type in `src/staves/index.ts`:

```ts
interface StaffModule {
  readonly type: 'tab' | 'standard' | 'percussion';
  geometry(track: Track, space: number): { lines: number; lineSpacing: number };
  measure(input: StaffBar): { onsets: { tick; left; right }[]; above: number; below: number };
  render(input: StaffBar, placement: StaffBarPlacement, sink: LayoutSink): void;
}
```

- `StaffBar` is the track's bar with its context: score, track, bar, master bar, indices, the track's visible staves (two means "both" mode), the clef in effect, the key and the staff space in px.
- `measure` reports, for every onset it draws (ticks from the bar start, as `beatTicks` sums them), the px it needs left and right of the onset's x, and the room it needs above the top line and below the bottom line. The engine takes the widest request per onset across all staves, so tab numbers, note heads and accidentals on different staves all push the same column apart.
- `render` gets the bar's content area, the staff's line positions, its system index, `onsetX(tick)` and, when the bar before or after it is in the same system, that bar's content area and `onsetX` as `previous` and `next`, so a tie, slide or extent that crosses the bar line is drawn in one piece and a bar line can be told from a system break. It pushes primitives and anchors (`note` and `beat`) into the sink and must stay inside the room it measured.

The tab type still uses the placeholder module (`src/staves/placeholder.ts`), which reserves a two-digit fret number around each onset and emits beat anchors only, until WP-021 replaces it; WP-022 adds effect glyphs inside the tab module's measure and render.

### Standard and percussion staves

`src/staves/standard/` holds both five-line modules, `standardModule(options)` and `percussionModule()`; the rules they follow are in [`notation.md`](../../docs/reference/notation.md). One pure function, `planBar`, lays a bar out relative to each onset's x and the staff's top line: heads, accidentals, stems, rests, graces, beam groups, tuplets, fingering and dynamics. `measure` reads its extents (beams at the furthest they can reach, since the bar is not spaced yet) and `render` places it, fitting the beams to the real stem positions, which never reach further than measured. The plan is memoised per `Bar` object and its inputs, so a layout plans each bar once.

- `standardModule({ courtesyAccidentals })` is the configuration point; the registered module has courtesy accidentals on.
- A bar's plan reads the bar before it (courtesy accidentals, ties coming in, dynamics), so the cache keys every bar of a five-line staff on its predecessor as well.
- **Both mode**: when `StaffBar.staves` is `['standard', 'tab']`, the standard staff draws all the rhythm notation and the tab module must draw fret numbers only (`staves.includes('standard')`), and leave dynamics and fingering to the standard staff. This is the contract WP-021's tab module follows.
- `src/staves/standard/rhythm/` is staff-agnostic rhythm notation (stems, flags, beams and beam grouping, dots, ties, tuplet marks) taking x positions, note-head y extents, directions and durations as parameters, ready to merge with the tab module's own.
- Anchors: one `note` anchor per head (grace notes included) with the head's box, less any width it shares with a neighbour across a stem; one `beat` anchor per beat and voice.

## Metrics pipeline

The engine reads two committed tables and never a font:

- `src/metrics/bravura.json`: for every glyph the engine uses, its codepoint, advance width (from the font's own `hmtx`) and bounding box and anchors (from the SMuFL metadata), in staff spaces, plus Bravura's engraving defaults (line, stem, beam and bar-line thicknesses).
- `src/metrics/geist.json`: advance widths in font units of Geist Variable at weight 400 for printable ASCII and the extra characters tab labels use, with the font's units per em, ascent, descent, cap height and x-height. Text is measured without kerning; a character outside the table measures as the digit `0` does.

`scripts/layout/metrics.ts` generates both with `fontkit` from the Bravura font in `apps/web/public/fonts/bravura/` (provenance in the README there), the SMuFL metadata in `scripts/layout/data/` and the Geist font of `@fontsource-variable/geist`. Run it by hand with `pnpm layout:metrics` after adding a glyph to its `GLYPHS` list or updating a font; `pnpm layout:metrics:check` and `scripts/layout/metrics.test.ts` fail when the committed tables are stale.

## Cache

`LayoutCache` holds, per master-bar id, the bar's measurement and the inputs it was made from, plus the systems of the last layout. On the next call a bar is re-measured when it is listed in `dirtyBars` or when its inputs differ by identity: Immer keeps unchanged nodes, so an edit that `touchedBars` misses is still caught. Systems that end before the first re-measured bar (and whose bars are still the same ids at the same indices) are reused with their primitives and anchors; breaking resumes from there. A bar shown on a standard or percussion staff is also re-measured when the bar before it changes, since its accidentals, ties and dynamics read it. Changing anything bars are measured with (zoom, visible tracks, notation, a track's tuning, capo, fret count or clef) drops the cache; changing only page geometry or a track's name keeps the measurements and drops the systems. A cached layout is identical to a cold one; the tests compare them byte for byte.

## Decisions

Where the contract left something open:

| Question                              | Decision                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Several pages in one coordinate space | Stacked vertically, `pageGap` apart; `Page.bbox` places each.                                                                                |
| What `zoom` scales                    | The notation; paper size and margins stay as given.                                                                                          |
| Continuous mode and virtualization    | Systems are segments of the one line, about `width` px each.                                                                                 |
| `Bar.clef` without a later change     | Holds until the next bar that sets a clef.                                                                                                   |
| Notation a track cannot show          | Drums always percussion; tab without strings falls back to standard.                                                                         |
| Justifying the last paged system      | Only when it is at least three quarters full.                                                                                                |
| Signatures at a line start            | Clef and key on every line; the time signature only at the start and on a change.                                                            |
| Courtesy signatures                   | Paged systems end with the next system's key and time change after the last bar line; `SystemPlan.courtesy` reserves the room when breaking. |
| Repeat counts                         | `xN` above the end repeat for N > 2 plays.                                                                                                   |
| Double coda and segno segno           | The single glyph drawn twice; SMuFL has no double form.                                                                                      |
| Tempo in another unit                 | The number shown against `unit` is `bpm` converted from quarters, rounded to 0.01.                                                           |
| Bar lines in a track with two staves  | End bar lines run on through the gap between the staves; repeat dots stay inside each.                                                       |
| Determinism                           | Byte-identical results for identical input, except `metrics.layoutMs`.                                                                       |

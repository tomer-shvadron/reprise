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
- **`zoom` scales the notation, not the paper.** Staff space, text and the staff, track and system gaps scale with it; `width`, `pageHeight`, the margins and `pageGap` are taken as given. A higher zoom therefore fits fewer bars on a line. The painter lays out at zoom 1 and zooms by scaling each system's SVG viewBox, never by re-laying out; see [the score feature's README](../../apps/web/src/features/score/README.md#zoom).
- **Rounding.** Every coordinate is rounded to 1/100 px when it is emitted, so results serialise compactly and compare exactly.

## API

`layout(score, options, cache?)` returns `{ pages, systems, primitives, anchors, metrics }`:

- **`LayoutOptions`** is the contract's `{ mode, width, pageHeight?, zoom, tracks, notation }` plus optional `margins` (48 px a side paged, 16 continuous), `pageGap`, `staffGap` (12), `trackGap` (24), `systemGap` (32) and `dirtyBars`. `pageHeight` defaults to A4; `PAGE_SIZES` holds A4 and Letter at 96 dpi. `notation` overrides a track's `display.notation` by track id.
- **`Primitive`** is `glyph` (a Bravura glyph: SMuFL name, codepoint, font size; `x, y` the glyph origin on its baseline), `line` (`x, y` to `x2, y2`, a thickness, an optional dash), `path` (SVG path data in layout coordinates, filled or stroked) or `text` (UI font; `x, y` the baseline point `anchor` refers to). Each has a `bbox`, a theme `role` (`ink`, `paper`, `accent`, `muted`; everything in this package is `ink`) and, where it draws one model node, that node's id in `node`.
- **`Anchor`** maps a model node to its hit box: `note` (from WP-021 and WP-023), `beat` (one per beat, voice and staff), `bar` (one per track bar, carrying `track`, and one per master bar and system part for the column across that part's staves, without), `staff` (keyed by track id, one per staff and system) and `system` (one per system or part, keyed by its id). Within one system, kind, track, staff and voice, anchors never overlap; the tests assert it.
- **`System`** has a stable `id` (`system:<first master-bar id>`), its page, its master-bar range, its box, its staves' line positions, and the ranges of `primitives` and `anchors` that belong to it: both arrays are ordered by system, so a painter virtualizes by slicing them. A system taller than the page is split into parts (see below): each part is a `System` on its own page, consecutive parts share `bars`, `part` numbers them (0, 1, …; absent on a whole system) and a part after the first has the id `system:<first master-bar id>/<part>`; its staves, box and ranges are its own.
- **`Page`** has its box and its range of systems.
- **`metrics`** has `layoutMs` (wall clock, the one field that differs between identical calls), the primitive and anchor counts, `measuredBars` and `reusedSystems`, every system or part taken from the cache rather than rendered, before or after the edit; the systems rendered, counted in parts, are `systems.length − reusedSystems`.
- `hitTest(result, x, y)` returns the most specific anchor under the point: by kind (note, beat, bar, staff, system), then a track's bar over the master bar's column, then the smallest. It only searches systems whose box holds the point.

## How a layout is made

1. **Options** resolve to the visible tracks and the staves each shows: tab, standard, or standard above tab for `both`. Drum tracks always get a percussion staff, and a track without strings falls back from tab to standard.
2. **Context.** For every master bar: the clef in effect on each track (`Bar.clef` holds until the next bar that sets one), and whether the time signature or key changes there.
3. **Measure** (`measure.ts`), once per master bar across every visible staff: the onsets of every beat in every visible voice, merged so tracks and voices align; one spring per onset, whose natural width is the duration width (`spacing.ts`: Gourlay-style up to a quarter, a 64th 1 staff space and each doubling adding 0.7, so a quarter is 3.8; beyond a quarter Guitar Pro's feel, 3.8 × q^0.85 spaces for q quarters, so a half is 6.8 and a whole 12.3, on every staff) scaled by how much of the shortest beat starting there the gap covers, and whose minimum is the room the staff modules ask for either side of the onsets; and the fixed parts (clef and key changes, time signature, start repeat, padding, end bar line). An anacrusis spans what it holds, not its time signature. Header markings (tempo, section, jumps) widen a bar that is too narrow for them.
4. **Break** (`breaking.ts`): greedy, bar by bar against the width left after the track names and the line's clefs and key, always at least one bar, so a bar wider than the page overflows rather than splitting. Paged systems are then stretched to the right margin, all but a last one under three quarters full; stretching scales the springs and never goes below their minimums.
5. **Stack** (`vertical.ts`): header bands for sections, tempo, jumps and targets, and voltas, only when a bar of the system has one; then each track's staves with the room their bars ask for next to the staff, the lanes the system's bars draw into stacked outside it (one row per kind, as tall as the tallest request, so a lane lines up across the system's bars), `staffGap` within a track and `trackGap` between tracks. Paged systems flow down the pages, a new page when the next would cross the bottom margin; a system taller than the page's content area is split between its staves (`split.ts`), each part at a page top.
6. **Draw** (`render.ts`, `furniture.ts`, `header.ts`): track names, staff lines, the line's opening bar line, clefs and key signatures, then per bar its signature changes (a key change cancelling the old key with naturals), the staff module's content, bar lines and header markings, the courtesy signatures at a paged system's end, and the anchors.

### Systems taller than a page

A paged system taller than `pageHeight` less the top and bottom margins is split into parts, never scaled (#85; the rules and the references are in [notation.md](../../docs/reference/notation.md#systems-taller-than-the-page-85)). `splitSlots` fills each part greedily with whole tracks, separating a track's staves only when the track alone does not fit and leaving a single staff taller than the room as a part of its own. The first part goes at the top of the current page if it is empty, otherwise of the next, and each further part at the top of the page after. Every part is rendered from the system's `SystemPlan`, so it keeps the system's horizontal positions, with `partVertical` moving its staves to its own top; it draws only its own staves, and its opening bar line joins them whenever the system has two or more staves. The first part keeps the header rows and the `xN` lane; a continuation opens with a bar-number row (`barNumber`, 2.4 spaces) and the volta row when the system has one.

### Continuous mode

One line, natural widths. It is still cut into systems: consecutive segments of about `width` px, side by side on one page, so the painter can virtualize a long line the same way it virtualizes pages. The painter passes a fixed `width` of 640 px (`CONTINUOUS_SYSTEM_WIDTH`), not the viewport's, which bounds the elements a mounted segment brings; see [the score feature's README](../../apps/web/src/features/score/README.md#zoom). Only the first segment carries track names, clefs and key; the others continue the staff seamlessly. All segments share the vertical layout of the whole line.

## Staff modules

The engine owns spacing, breaking, stacking and the furniture every staff shares. What a staff type draws inside a bar comes from a `StaffModule` (`src/staves/staff-module.ts`), registered by type in `src/staves/index.ts`:

```ts
interface StaffModule {
  readonly type: 'tab' | 'standard' | 'percussion';
  readonly minRoom: { above: number; below: number }; // staff spaces
  geometry(track: Track, space: number): { lines: number; lineSpacing: number };
  measure(input: StaffBar): { onsets: { tick; left; right }[]; above: number; below: number };
  lanes(input: StaffBar): Partial<Record<LaneId, number>>; // px
  render(input: StaffBar, placement: StaffBarPlacement, sink: LayoutSink): void;
}
```

- `StaffBar` is the track's bar with its context: score, track, bar, master bar, indices, the track's visible staves (two means "both" mode), the clef in effect, the key and the staff space in px.
- `measure` reports, for every onset it draws (ticks from the bar start, as `beatTicks` sums them), the px it needs left and right of the onset's x, and the room it needs next to the top line and the bottom line, inside the lanes. The engine takes the widest request per onset across all staves, so tab numbers, note heads and accidentals on different staves all push the same column apart. It reads this bar only, so the engine caches it.
- `lanes` reports the lanes (`src/staves/lanes.ts`: `LANES_ABOVE` and `LANES_BELOW`, nearest the staff first) the bar draws into and the height each needs. It reads this bar and the dynamic entering it (a dynamic shows only where it changes), so the engine caches each bar's requests with that dynamic. `minRoom` is the floor of the room around the staff whatever the bars hold.
- `render` gets the bar's content area, the staff's line positions, its system index, `onsetX(tick)`, the absolute bands of the system's lanes on this staff (`lanes`), whether the bar opens a line (`lineStart`) and, when the bar before or after it is in the same system, that bar's content area and `onsetX` as `previous` and `next`, so a tie, slide or extent that crosses the bar line is drawn in one piece and a bar line can be told from a system break. It pushes primitives and anchors (`note` and `beat`) into the sink, must stay inside the room it measured and draws a lane's items only into that lane's band. It may read its own track's bars up to `BAR_REACH` (three, `TIE_REACH_BARS`) either side of this one (a tie half at a system end looks up to three bars ahead for its continuation), the master bars one either side, and the dynamic entering the bar; nothing else of other bars. The cache's reuse rule rests on that reach.

Every staff type has its module. None of them needs to touch spacing or breaking.

### Note effects (`src/staves/effects/`)

What every staff shares for effects; every staff uses it. The rules are in [`notation.md`](../../docs/reference/notation.md#note-effects-wp-022).

- `analysis.ts`: `analyseEffects(bar, space, options)` finds a bar's lane items per onset, its runs (merged across voices on the onset grid), its whammy graphs, its lane heights and the room each onset reserves, memoised per `Bar`; `barRuns(bar)` is the space-free part that a neighbouring bar reads to tell whether a run carries on across the bar line.
- `draw.ts`: `drawLanes` draws them into the bands of the system: labels with dashed lines and end ticks, waves, the whammy graph; a run's label repeats at a paged line start, not at a continuous segment.
- `bend.ts`: bends, pre-bends, releases and holds, sharing a chord's tips and labels.
- `shapes.ts`: procedural waves, sawtooth and vertical waves as stroked paths, one per run and bar rather than repeated glyphs. `labels.ts`: bend amounts and harmonic text.
- `connections.ts`: who a slide or hammer-on connects to (`nextOnString`, `connections(bar)`, `shifts`, `hammerLetter`, `targetIsHigher`) and the voice and tick lookups both staves use. `letters.ts`: `drawLetter`, the `H`, `P` and `sl.` letters over a paper knockout. `marks.ts`: `tremoloGlyph` and `articulationMarks`, the union rule. `strokes.ts`: `drawStroke`, an arpeggio's wave or a brush's line with its arrowhead. `bend.ts` also holds `BEND_FRAME` and `BEND_ROOM`, which the tab's `TAB` constants reference.
- `src/staves/dynamics.ts` holds the one dynamics rule every staff draws by (`shownDynamics`, per voice against the voice's previous played beat, memoised per `Track`) and what `measure` reserves for it from the bar alone (`reservedDynamics`).

### Tab (`src/staves/tab/`)

`tabModule({ tiedNotes })` draws one line per string, fret numbers over `paper` knockouts, rests, grace notes, the rhythm notation of each voice (voice 1 below the staff, the others above when voice 1 is present), ties, the note effects, and in its lanes chord names, fingering, beat text, lyrics and dynamics; under a standard staff (both mode, read from `StaffBar.staves`) it draws the numbers, ties, words and lane effects only (ADR-0021, ADR-0022). `staffSlots` builds it per layout from `LayoutOptions.tiedNotes`, which is part of the bar cache key. Its rules and numbers are in [`notation.md`](../../docs/reference/notation.md) under "Tab staff" and "Rhythm notation". It emits a `note` anchor per note (the knockout box, grace notes included) and a `beat` anchor per beat, voice by voice.

- `analysis.ts` turns a bar into what measure and render both need (labels with their harmonic and trill suffixes, extents including slides, bends and stroke arrows, beam and tuplet groups, tremolo stem lengths, the rows drawn above and below), cached per `Bar` object. It reads the bar alone, so a cached measurement stays true; render also reads other bars of the track (tie and hammer-on origins up to three bars back, slide origins one bar back, the dynamic in effect from every earlier bar, the next bar for runs and connections that cross the bar line), which is safe because the cache rebuilds every system within `BAR_REACH` bars of a re-measured bar, on either side.
- `lanes.ts` is the module's `lanes()`: the effect lanes, the word lanes, lyrics and, in tab mode, dynamics.
- `effects.ts` draws what sits on the strings: bends, slides, hammer-on arcs with their letters, the halves of connections at a system break, and arpeggio and brush arrows, with the helpers it shares with the five-line staves from `src/staves/effects/`.
- `measure.ts` and `render.ts` are the module's measure and render.

### Rhythm notation (`src/staves/rhythm/`)

The grouping rules every staff shares (`grouping.ts`: the beat-grouping table, beam groups and tuplet groups by alphaTab's rule) and the tab's drawing helpers (`draw.ts`: stems, flags, horizontal beams, dots, tuplet marks and ties, taking x positions, y positions and a `StemDirection`, pushing primitives into the sink). The five-line staves draw with `src/staves/standard/rhythm/`, whose beams slope; folding the two drawing sets into one is open.

| Export                                                         | What it does                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `RhythmEvent`, `beamCount(duration)`                           | A beat as rhythm sees it (tick, ticks, duration, dots, tuplet, silent); beams per duration. |
| `beamGrouping(timeSignature)`, `beamGroups(events, signature)` | The beat-grouping table, and the beamed groups of a voice by index (a group of one flags).  |
| `tupletGroups(events)`                                         | Runs of beats under one tuplet number.                                                      |
| `drawStem`, `drawFlag`, `flagWidth`, `drawBeams`, `BEAM_PITCH` | Stems, flags by their SMuFL stem anchor, horizontal beams with partial beams.               |
| `drawDots`, `dotsWidth`, `drawTuplet`, `drawTie`               | Augmentation dots, tuplet numbers with an optional bracket, ties as filled crescents.       |

### Standard and percussion staves

`src/staves/standard/` holds both five-line modules, `standardModule(options)` and `percussionModule()`; the rules they follow are in [`notation.md`](../../docs/reference/notation.md). One pure function, `planBar`, lays a bar out relative to each onset's x and the staff's top line: heads, accidentals, stems, rests, graces, beam groups, tuplets, fingering and dynamics, and the effects at the notes: harmonic diamonds, ghost parentheses, articulations, tremolo lengthening (an unbeamed stem's tip, or a beam moved out by `GroupPlan.extend`), the room for strokes, slides and bends, and the slur room from the bar before. `effects.ts` draws those effects. `measure` reads its extents (beams at the furthest they can reach, since the bar is not spaced yet) and `render` places it, fitting the beams to the real stem positions, which never reach further than measured. The plan is memoised per `Bar` object and its inputs (of the track only `kind`, `tuning`, `capo` and `display`, which keep their objects across note edits, and the number of staves the track shows, since letters, brushes and bend room exist only on a lone standard staff), so a layout plans each bar once and a re-layout re-plans only the bars it re-measures.

- `standardModule({ courtesyAccidentals })` is the configuration point; the registered module has courtesy accidentals on.
- A bar's plan reads the bar before it (courtesy accidentals, ties coming in) and the key it cancels, so the cache keys every bar of a five-line staff on its predecessor and the previous key signature as well. Dynamics are drawn in the dynamics lane by the shared rule; `measure` reserves room for them from the bar alone.
- **Alone**: a standard staff that is its track's only staff also requests the effect lanes (`analyseEffects` without articulations), reserves their room in `measure` and draws them with `drawLanes`; its bends go from the heads into its bend lane.
- **Both mode**: when `StaffBar.staves` is `['standard', 'tab']`, the standard staff draws all the rhythm notation, dynamics and fingering and the effects attached to the notes, and the tab the lane effects and the letters; what the tab keeps is the tab's **Both mode** bullet in [`notation.md`](../../docs/reference/notation.md#tab-staff-wp-021).
- `src/staves/standard/rhythm/` draws the five-line staves' rhythm notation (stems, flags, sloped beams, dots, ties, tuplet marks) from x positions, note-head y extents, directions and durations; beam and tuplet grouping come from the shared `src/staves/rhythm/`.
- Anchors: one `note` anchor per main head (grace notes included) with the head's box, less any width it shares with a neighbour across a stem, a diamond's kept to one staff space tall; a sounding diamond has none; one `beat` anchor per beat and voice.
- Known: the origin half of a hammer-on or legato slur cut by a system break keeps room only when it starts in its voice's last beat, so it can reach about 0.45 spaces past the measured room otherwise, as the tab's arcs can.

## Metrics pipeline

The engine reads two committed tables and never a font:

- `src/metrics/bravura.json`: for every glyph the engine uses (clefs, signatures, rests, flags, dynamics, tuplet digits and the effect glyphs: articulations, tremolo strokes, bow marks, fades, the trill ornament and note-head parentheses among them), its codepoint, advance width (from the font's own `hmtx`) and bounding box and anchors (from the SMuFL metadata), in staff spaces, plus Bravura's engraving defaults (line, stem, beam and bar-line thicknesses).
- `src/metrics/geist.json`: advance widths in font units of Geist Variable at weight 400 for printable ASCII and the extra characters tab labels use, with the font's units per em, ascent, descent, cap height and x-height. Text is measured without kerning; a character outside the table measures as the digit `0` does.

`scripts/layout/metrics.ts` generates both with `fontkit` from the Bravura font in `apps/web/public/fonts/bravura/` (provenance in the README there), the SMuFL metadata in `scripts/layout/data/` and the Geist font of `@fontsource-variable/geist`. Run it by hand with `pnpm layout:metrics` after adding a glyph to its `GLYPHS` list or updating a font; `pnpm layout:metrics:check` and `scripts/layout/metrics.test.ts` fail when the committed tables are stale.

## Cache

`LayoutCache` holds, per master-bar id, the bar's measurement, the inputs it was made from and its lane requests, plus the systems of the last layout with where each was placed. A split system is cached as one entry holding its parts and where each went, and its parts are reused or rebuilt together. On the next call a bar is re-measured when it is listed in `dirtyBars` or when its inputs differ by identity: Immer keeps unchanged nodes, so an edit that `touchedBars` misses is still caught. A bar shown on a standard or percussion staff is also re-measured when the bar before it or the previous master bar's key signature changes, since its accidentals, ties and cancelling naturals read them. Changing anything bars are measured with (zoom, visible tracks, notation, a track's tuning, capo, fret count or clef) drops the cache; changing only page geometry or a track's name keeps the measurements and drops the systems.

Systems are reused by identity, before and after the edit:

- **The window.** A system is rebuilt when a re-measured bar lies within `BAR_REACH` bars of it on either side, the reach of a module's `render`. That also redraws a tie half at a system end when its continuation, up to three bars on, is edited (#88).
- **The checks.** Every other system is reused when its master bars are the same ids at the same indices, its break plan is the same, every part is placed exactly where it was, holding the same staves, from the same unrounded vertical stack, the dynamic entering its first bar is the same and, in continuous mode, the shared vertical layout is the same. A reused system keeps its `System` object while its index and ranges hold; its anchors are copied with the new index only when the system count changed before it.
- **Convergence.** Breaking runs lazily from the first system that is not reused. Once a reused system lies more than `BAR_REACH` bars past the last re-measured bar, and the bar count is unchanged, the breaks, placements and entering dynamics after it all follow from its own, so the rest of the old systems are appended as they were.
- **Lanes.** Each bar's lane requests are cached with the dynamic entering it. One forward pass per call recomputes them for a re-measured or moved bar, then compares entering dynamics only until one matches again, since the dynamic entering a bar follows from the bar before and the dynamic entering it.

What still re-renders every later system: a continuous edit that changes a bar's width (coordinates are absolute and rounded when emitted, so a moved segment is not its old bytes shifted; #101), a change to the continuous line's shared vertical layout (the first chord name, dynamic change or tempo marking anywhere), a bar inserted or removed (indices shift), and a page-geometry or name change (`systemKey`). In paged mode an edit that moves a page break re-renders every later system too: from that page on, every page starts one system earlier or later, so no later system is placed where it was. The first dynamic, let ring, chord name or text in a system adds a lane and can do it. The `pnpm bench` row "Re-layout after a page-break-moving edit, paged" measures it on the long score's first track in tab (100 systems on 20 A4 pages; all eight tracks fill a page per system, so no break can move): 67 systems rendered, p50 5.9 ms on the reference machine, with no budget. A cached layout is identical to a cold one; the tests compare them byte for byte, and a property test does so over random edit sequences.

## Decisions

Where the contract left something open:

| Question                              | Decision                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Several pages in one coordinate space | Stacked vertically, `pageGap` apart; `Page.bbox` places each.                                                                                  |
| What `zoom` scales                    | The notation; paper size and margins stay as given.                                                                                            |
| Continuous mode and virtualization    | Systems are segments of the one line, about `width` px each.                                                                                   |
| `Bar.clef` without a later change     | Holds until the next bar that sets a clef.                                                                                                     |
| Notation a track cannot show          | Drums always percussion; tab without strings falls back to standard.                                                                           |
| Justifying the last paged system      | Only when it is at least three quarters full.                                                                                                  |
| Signatures at a line start            | Clef and key on every line; the time signature only at the start and on a change.                                                              |
| Courtesy signatures                   | Paged systems end with the next system's key and time change after the last bar line; `SystemPlan.courtesy` reserves the room when breaking.   |
| Repeat counts                         | `xN` above the end repeat for N > 2 plays, in its own lane above the system's first staff.                                                     |
| Rows above and below a staff          | Lanes in a fixed order, sized per system so they line up across bars; two kinds never share a row.                                             |
| Effects in both mode                  | Lane effects once, on the tab (ADR-0022); articulations and tremolo strokes on the standard staff (#86).                                       |
| Harmonics on five-line staves         | Diamonds at the rounded sounding pitch, `Math.round(soundingPitch(track, note))`; a natural harmonic's is its head, the others' an extra head. |
| Articulations on five-line staves     | On the head side with one voice; on the stem side with several and on drums.                                                                   |
| Ghost notes on five-line staves       | Parenthesis glyphs around each ghost head, outside both head columns.                                                                          |
| Bends on a lone standard staff        | The tab's shafts, from the heads into the staff's bend lane; no target heads (#111).                                                           |
| Arpeggio and brush                    | An arpeggio on both staves; a brush on the standard staff only when it is alone, since in both mode the tab draws it.                          |
| Waves                                 | Procedural paths, one per run and bar, not repeated SMuFL wiggle glyphs.                                                                       |
| Dynamics                              | One rule on every staff: per voice, against the voice's previous played beat in any earlier bar.                                               |
| Double coda and segno segno           | The single glyph drawn twice; SMuFL has no double form.                                                                                        |
| Tempo in another unit                 | The number shown against `unit` is `bpm` converted from quarters, rounded to 0.01.                                                             |
| Bar lines in a track with two staves  | End bar lines run on through the gap between the staves; repeat dots stay inside each.                                                         |
| Determinism                           | Byte-identical results for identical input, except `metrics.layoutMs`.                                                                         |
| System reuse after an edit            | Every system more than `BAR_REACH` bars from a re-measured bar, placed and entered as before, is reused by identity.                           |
| Continuous width changes              | Re-render every later segment; translating rounded coordinates would not give a cold layout's bytes (#101).                                    |
| Long-note spacing                     | One curve in the engine for every staff, Guitar Pro's feel beyond a quarter, so switching notation keeps bar widths.                           |
| A system taller than the page         | Split between tracks into parts at page tops, never through a staff and never scaled; no reference splits or scales automatically (#85).       |
| A continuation's header               | Bar numbers, then voltas when the system has them; sections, tempo, jumps and `xN` stay on the first part.                                     |
| Bar numbers                           | On continuations only, every bar, `masterBarIndex + 1`.                                                                                        |

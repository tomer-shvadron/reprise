# Phase 2: Three lanes to the player checkpoint

Parallel. Three agents, each in its own worktree, each owning one package. The lead integrates as lane work merges. Exit condition: the **player checkpoint** as defined in `roadmap.md`.

Each lane reads before starting: `../specs/shared-understanding.md`, `../specs/architecture.md`, `../reference/score-model.md`, its own reference note, and the ADRs its work packages cite. A lane does not edit `packages/model`; it opens a `type:contract` issue instead.

---

# Score lane `[P:score]`

Owns `packages/layout` and `apps/web/src/features/score`. Reference: `../reference/notation.md` (written by this lane in WP-020 as it discovers rules), ADR-0007, ADR-0010.

## WP-020: Layout engine core

- **Size**: L · **Blocked by**: WP-015
- **Packages**: `packages/layout`

**Deliverables**

- The `layout()` and `hitTest()` API from the architecture contract, with `LayoutOptions`, `LayoutResult`, `Primitive`, `Anchor`, `System`, `Page`.
- Horizontal spacing: a per-beat width function of duration (logarithmic, Gourlay-style), minimum spacing for glyph collisions, stretched to fill the system width in paged mode, natural width in continuous mode.
- System breaking: greedy fill of bars per line against the available width, with a bar never split; page breaking by system height in paged mode.
- Vertical stacking: for each system, one staff group per visible track, each group holding the staves its notation mode needs, with configurable gaps; track names in the left margin of the first system and short names after.
- A font metrics table generated at build time from Bravura and the UI font (`scripts/layout/metrics.ts`), so the engine measures text without a DOM.
- Bar lines, time signatures on change and at the start, key signatures on standard staves, clefs, tempo marks, section markers and repeat signs as primitives (glyph placement only; staff-specific content comes in the next packages).
- A `LayoutCache` keyed by bar ID that stores per-bar measurements; `layout()` with a cache and a list of dirty bars re-measures only those and re-breaks systems from the first dirty bar.

**Acceptance criteria**

- Layout of an empty score, a one-bar score and the long fixture each produce valid results with no overlapping anchors.
- Data snapshot tests on small hand-built scores.
- Deterministic: same input, same output, byte-identical.

## WP-021: Tab staff

- **Size**: L · **Blocked by**: WP-020
- **Packages**: `packages/layout`

**Deliverables**

- String lines for any string count, fret numbers centred on strings with a background knockout, rest glyphs on tab, dead notes as `x`, ghost notes in parentheses, tied notes as a parenthesised number or hidden per setting.
- Rhythm notation under the tab: stems, flags and beams by duration, beam groups by time signature and beat grouping, dots, tuplet brackets with numbers, ties as arcs between beats, grace note stems smaller.
- Beat text, chord names above, lyrics lines below, fingering, dynamics where present.
- Two-voice rendering: voice 1 stems down, voice 2 stems up when both are present, per Guitar Pro convention.

**Acceptance criteria**

- Snapshot tests per feature using the builders.
- A human check against Guitar Pro screenshots of the same fixtures, recorded in the PR with side-by-side images.

## WP-022: Note effect glyphs

- **Size**: M · **Blocked by**: WP-021
- **Packages**: `packages/layout`

**Deliverables**

- Bends as arrows with the amount label (1/4, 1/2, full, 1 1/2, 2) following the bend kind including release and prebend shapes; slides as lines in each direction; hammer-on and pull-off arcs with `H`/`P`; vibrato and wide vibrato as waves; palm mute as `P.M.` with a dashed extent; let ring as `let ring` with extent; harmonics as `N.H.`, `A.H.`, `T.H.`, `P.H.`, `S.H.` labels and diamond heads on the standard staff; tapping `T`; tremolo picking strokes on the stem; trill `tr` with the target fret; staccato dots, accents, fade-in hairpins, pick strokes, arpeggio and brush arrows, slap and pop `S`/`P`.
- Extent merging: consecutive palm-muted or let-ring beats share one label and one line.

**Acceptance criteria**

- Each effect has a snapshot test; a fixture with every effect renders without overlaps on the anchors.

## WP-023: Standard and drum staves

- **Size**: L · **Blocked by**: WP-020
- **Packages**: `packages/layout`

**Deliverables**

- Standard staff for fretted and pitched tracks: clef, key signature, accidentals with measure memory and courtesy accidentals, note heads by duration, stems with direction by position (and by voice when two voices), beams, flags, rests, ledger lines, ties, dots, tuplets, grace notes, chords (stacked notes with second-interval offsets), dynamics.
- Drum staff: percussion clef, five lines, note position and head shape from the GM percussion map (cross heads for cymbals and hi-hat, normal for drums), stems up, rests.
- When a track shows both, the standard staff sits above the tab with stems only on the standard staff and tab numbers without rhythm notation, per Guitar Pro's "both" mode.

**Acceptance criteria**

- Snapshots for every clef and key; a drum fixture renders every GM percussion instrument used in the fixture corpus.

## WP-024: SVG painter

- **Size**: M · **Blocked by**: WP-021
- **Packages**: `apps/web/src/features/score`

**Deliverables**

- A React component that takes a `LayoutResult` and paints only the systems intersecting the viewport plus one on either side, keyed by system ID so unchanged systems don't re-render.
- Bravura loaded as a web font with glyphs referenced by codepoint; text in the UI font; every primitive mapped to a theme role (`ink`, `paper`, `accent`, `muted`) resolved through CSS variables so the light and dark themes and the print stylesheet all work without re-layout.
- Zoom by scaling the SVG viewBox, display only, never re-laying out; continuous mode lays out in fixed 640 px segments. Segments as wide as the viewport were dropped with the re-layout threshold: at zoom 0.5 on a 1 920 px viewport one would hold about 9 200 elements, and three or four mounted ones break the 20 000-element budget, where fixed segments keep the long score under 12 600 at every zoom (WP-024, #30).
- Overlays: a playback cursor (a vertical bar at the current beat with a soft highlight of the bar), selection highlight, hover highlight, each driven by anchors.
- A demo route `/dev/score` that renders any fixture, for the lane's own iteration and for the lead's review.

**Acceptance criteria**

- Mounted element count on the long fixture stays under the budget at every zoom.
- Scrolling the long fixture stays at 60 fps in the Chrome performance panel; recorded in the PR.

## WP-025: Printing

- **Size**: S · **Blocked by**: WP-024
- **Packages**: `apps/web/src/features/score`

**Deliverables**

- A print view that re-lays the score in paged mode at the selected paper size (A4, Letter) and margin, paints all pages with no virtualization, and applies a print stylesheet forcing the paper theme.
- A print command in the palette and the File menu calling `platform().print()`.
- Header on the first page (title, artist, album) and page numbers.

**Acceptance criteria**

- Print to PDF from Electron produces correctly paginated output on both paper sizes for three fixtures; PDFs attached to the PR.

## WP-026: Layout tests and visual regression

- **Size**: M · **Blocked by**: WP-021, WP-023
- **Packages**: `packages/layout`, `apps/web/e2e`

**Deliverables**

- A reference score set (six fixtures covering tab only, standard only, both, drums, pitched, long) rendered through the demo route under Playwright, screenshots compared against committed baselines with a tolerance; a documented command to update baselines deliberately.
- Layout data snapshot coverage for every staff feature.

**Acceptance criteria**

- Moving a stem by two pixels in the layout code fails the visual test; the PR demonstrates this with a deliberate change and revert.

## WP-027: Layout performance and incremental re-layout

- **Size**: M · **Blocked by**: WP-024
- **Packages**: `packages/layout`, `apps/web/src/features/score`

**Deliverables**

- The benchmark test from `roadmap.md` for layout: cold layout of the long fixture under budget; single-note edit re-layout under budget via the cache and `touchedBars`.
- Profiling pass on the spacing and breaking code; a `metrics` field on every result.
- Worker readiness: a test that runs `layout()` in a Web Worker to prove it has no DOM dependency, without yet moving production layout there.

**Acceptance criteria**

- Budgets pass in CI; the numbers are in the PR body and in the roadmap table if they changed.

---

# Audio lane `[P:audio]`

Owns `packages/audio`. Reference: `../reference/sound-packs.md`, ADR-0004, ADR-0005.

## WP-030: Scheduler and transport

- **Size**: M · **Blocked by**: WP-015
- **Packages**: `packages/audio`

**Deliverables**

- The transport part of the `AudioEngine` contract: play, pause, stop, seek, tempo in BPM or percent, loop range, count-in, metronome, position events.
- A lookahead scheduler: a 25 ms timer that schedules every event due within the next 200 ms against `AudioContext.currentTime`, using the model's tempo map and playback sequence. Tempo changes apply from the next scheduled event; percent tempo scales the whole map.
- Loop handling by rescheduling from the loop start when the scheduled horizon crosses the loop end; seamless at the boundary.
- Count-in as one bar of metronome at the current tempo before the first scheduled beat; metronome as a synthesized click (two short sine bursts, accented downbeat) through its own gain.
- Position events at animation-frame cadence derived from `currentTime`, not from the scheduler, so the cursor is smooth.

**Acceptance criteria**

- OfflineAudioContext tests: a four-bar score at 120 BPM produces note onsets at the expected sample offsets within one millisecond; a loop over bars 2 to 3 repeats with the correct gap; count-in adds exactly one bar.

## WP-031: Sampler core

- **Size**: L · **Blocked by**: WP-015
- **Packages**: `packages/audio`

**Deliverables**

- Region maps: `{ keyLo, keyHi, velLo, velHi, rootKey, tune, sample, loop?, envelope, layer? }` as the common output of every loader.
- Voice pool with a configurable polyphony limit and oldest-quietest stealing; each voice is a buffer source into a gain into a per-voice filter, with `detune` and `gain` automation APIs exposed in semitones and dB.
- ADSR from region data; release on note-off; a `letRing` mode that defers note-off to the next note on the same string or the end of the bar.
- Per-track channel strip: gain, stereo panner, mute, solo logic, effects insertion point (empty in this phase); master bus with a limiter.
- `previewNote` for editor feedback.

**Acceptance criteria**

- Offline tests: a region is selected correctly for key and velocity; pitch shifting by `detune` lands within one cent of the target at the sample level (measured by zero crossings or FFT in the test); stealing never exceeds the limit.

## WP-032: SF2 loader and GM bundle

- **Size**: M · **Blocked by**: WP-031
- **Packages**: `packages/audio`

**Deliverables**

- An SF2 parser (an existing library if one fits the boundary rules, otherwise a minimal one covering presets, instruments, zones, generators for key and velocity ranges, root key, tuning, loop points, envelopes, and sample data) producing region maps per GM program and per percussion key.
- Lazy decoding: parse the file once, decode a sample only when a region first needs it, through `decodeAudioData` on a WAV wrapper of the raw PCM.
- GeneralUser GS bundled under `apps/web/public/sounds/gm/` with its license file, loaded through the platform adapter; a manifest describing the bundle.
- GM program to region-map resolution with bank fallback; percussion on channel semantics mapped from a drum track.

**Acceptance criteria**

- Every GM program used by the fixture corpus resolves; drum notes resolve to the kit.
- Memory test: loading a four-track song decodes only the samples its notes need, measured by the cache's byte count.

## WP-033: Articulation playback

- **Size**: L · **Blocked by**: WP-030, WP-031
- **Packages**: `packages/audio`

**Deliverables**

- Bends: the note's bend points to a `detune` automation curve across the beat's duration, including release and prebend shapes.
- Slides: shift slide as a detune glide into the next note's pitch over the last portion of the beat; legato slide as the same without retrigger; slide in and out from below and above as short glides.
- Hammer-on and pull-off: retrigger at reduced velocity with the attack portion skipped.
- Vibrato and wide vibrato as an LFO on detune; trill as alternating retriggers at the trill speed; tremolo picking as retriggers at the stroke rate.
- Palm mute: a low-pass filter plus a shortened envelope on the voice; dead note: a filtered noise burst; natural harmonic: pitch resolved from the fret's harmonic node; artificial, pinch and tapped harmonics: the stated pitch with a brighter filter; staccato: shortened envelope; accents and ghost notes: velocity scaling; grace notes: a short beat stolen from the previous or the following beat; ties: no retrigger.
- Dynamics to velocity mapping.

**Acceptance criteria**

- Offline tests per articulation asserting the audible property: a full bend ends two semitones up within one cent; a palm mute has less energy above 2 kHz than the same note unmuted; a tie produces no second onset; a hammer-on produces a quieter second onset.

## WP-034: Memory manager

- **Size**: M · **Blocked by**: WP-031
- **Packages**: `packages/audio`

**Deliverables**

- The decoded-buffer cache: byte accounting per buffer, LRU ordering by last scheduled use, a budget, eviction of whole instruments (not single samples) when over budget, pinning of instruments the current song uses so eviction prefers leftovers from the previous song.
- `load(score)` computes the instrument set from the tracks and the notes actually present, and preloads the regions the first bars need so playback starts without a gap.
- `memory()` reporting and a `memory` event on change.

**Acceptance criteria**

- Tests: loading song B after song A evicts A's instruments not shared with B; a budget below the needs of the current song degrades by evicting the least recently used and reloading on demand rather than failing; byte accounting matches buffer lengths.

## WP-035: Audio tests and harness

- **Size**: S · **Blocked by**: WP-030, WP-033, WP-034
- **Packages**: `packages/audio`

**Deliverables**

- A shared OfflineAudioContext harness with helpers: render a score through the engine, detect onsets, estimate pitch at a time, measure band energy.
- The environment choice for Vitest to run Web Audio (browser mode or a polyfill) finalised and documented in the package README.
- A fixture-wide smoke test: every fixture renders through the GM tier without throwing.

**Acceptance criteria**

- `pnpm --filter @reprise/audio test` runs in CI without a sound device. (Written `pnpm test --filter @reprise/audio` originally, which hands `--filter` to Vitest; corrected in WP-035.)

---

# Formats lane `[P:formats]`

Owns `packages/formats`. Reference: `../reference/file-formats.md`, ADR-0008.

## WP-040: gp3, gp4 and gp5 reader

- **Size**: XL · **Blocked by**: WP-015
- **Packages**: `packages/formats`

**Deliverables**

- A binary reader utility (little-endian ints, Pascal-style and byte-length-prefixed strings in the file's encoding, color, bitmask helpers).
- One reader for the three versions with version-gated sections: header and metadata, lyrics, RSE master settings (skipped but consumed), tempo and key, MIDI channels, master bars with time and key signatures, repeats, alternate endings, markers, triplet feel, tracks with strings, tuning, port, channel, capo, color, RSE track settings (consumed), bars with up to two voices in gp3/4 and up to two voices read from gp5's voice blocks, beats with duration, dots, tuplets, rests, text, chord diagrams, mixer changes, beat effects, notes with every effect in the model, and gp5's additional note and beat flags.
- Mapping every GP construct to the model, including things we don't render yet; anything unmapped goes into a `warnings` list with the byte offset, never silently dropped.
- Robustness: truncated files produce a partial score with a warning rather than an exception; unknown version bytes fail with the version string.

**Acceptance criteria**

- Every gp3, gp4 and gp5 fixture parses; track, bar and note counts match the fixture manifest.
- Round-trip through the native format is lossless for every fixture.
- A fuzz test feeds truncated and bit-flipped fixtures and asserts no uncaught exception.

**Notes**

- The corpus is thin on the binary side: lyrics, multiple voices, tempo changes and pitched (non-fretted) tracks exist only in `.gp` fixtures, and no gp3 fixture has more than one track (`fixtures/manifest.json`). Binary-format tests for those paths need hand-built files, which wait for a writer; until then they are covered through `.gp` and the oracle.
- The model's `tuplet` rule accepts ratios strictly between 1:2 and 2:1 and not 1:1. Guitar Pro 7 custom tuplets can fall outside it; if a GP7 fixture trips the rule, relax it to `n !== of` in the same PR and say so in the PR body (lead ruling on PR #19).
- Simile marks, wherever a format carries them (gpif's `SimileMark`, read by WP-042 and WP-043), are not modelled: expand the previous bar's beats (the two bars before it for the double form) into the bar with fresh ids and record a warning; export does not reproduce the mark. See `../reference/file-formats.md`.

## WP-041: alphaTab oracle

- **Size**: S · **Blocked by**: WP-040
- **Packages**: `packages/formats` (dev dependency only)

**Deliverables**

- A test-only comparison that parses each fixture with alphaTab and with our reader and compares, per track and bar, the beat durations and per note the string, fret and the effects alphaTab exposes.
- A tolerance list in the test, each entry justified in a comment, for places where the two models legitimately differ.
- A lint boundary that prevents alphaTab from being imported outside test files.

**Acceptance criteria**

- Differences outside the tolerance list fail the test; the list is short and each entry explains why.

## WP-042: gp reader (Guitar Pro 7 and 8)

- **Size**: L · **Blocked by**: WP-015
- **Packages**: `packages/formats`

**Deliverables**

- Zip reading via `fflate`; locate `Content/score.gpif`; XML parsing with a small dependency-free parser or `fast-xml-parser` if the boundary rules allow.
- A `gpif` model reader covering `Score`, `MasterTrack` (automations for tempo), `Tracks` with staves, properties, tunings, capo, instrument set, `MasterBars` with time, key, repeats, alternate endings, directions (segno, coda, jumps), sections, `Bars` with voices and clefs, `Voices`, `Beats` with rhythm references, properties, effects, lyrics, chord diagrams, `Notes` with properties (string, fret, bends as property lists, slides, harmonics, let ring, palm mute, vibrato, tie, accents, fingering), `Rhythms`.
- Shared between gp and gpx; written so WP-043 only adds the container.

**Acceptance criteria**

- Every gp fixture parses with counts matching the manifest; the oracle test extends to gp; round-trip lossless through native.

## WP-043: gpx container (Guitar Pro 6)

- **Size**: M · **Blocked by**: WP-042
- **Packages**: `packages/formats`

**Deliverables**

- A bit reader and the BCFZ decompressor (the LZ-style scheme documented in TuxGuitar's and alphaTab's sources, re-implemented from the description, not copied), producing the virtual file system; the BCFS directory parser; extraction of `score.gpif`.
- Reuse of the gpif reader from WP-042 with the few GP6-specific differences handled in one place.

**Acceptance criteria**

- Every gpx fixture parses with counts matching the manifest; the oracle test extends to gpx.

## WP-044: gp writer

- **Size**: L · **Blocked by**: WP-042
- **Packages**: `packages/formats`

**Deliverables**

- Model to gpif XML, the inverse of WP-042's mapping, and a zip writer producing a file Guitar Pro 7 and 8 open.
- A `dropped` list for anything in the model with no gpif representation (practice data never goes to gpif by design; the list is for score features).
- Validation strategy without Guitar Pro installed: alphaTab reads the written file in the oracle test, and the result is compared against the source score.

**Acceptance criteria**

- Native to gp to native round-trip is lossless for every fixture for the fields gpif can represent, and the dropped list is exactly the known set.

## WP-045: Format detection and import service

- **Size**: S · **Blocked by**: WP-040, WP-043
- **Packages**: `packages/formats`

**Deliverables**

- `detect(bytes)` by magic bytes and version strings; `read(bytes, format?)` dispatch; `write(score, format)` dispatch; a `Warning` type with severity, message and location.
- A `formats/README.md` describing what each reader covers and its known gaps.

**Acceptance criteria**

- Detection is correct for every fixture and for a renamed file with the wrong extension.

---

# Integration `[I]` to the player checkpoint

Lead only. Starts as soon as WP-024, WP-032 and WP-045 are merged; the remaining lane packages land during integration.

## WP-050: Document store and engine wiring

- **Size**: M · **Blocked by**: WP-024, WP-032, WP-045
- **Packages**: `apps/web/src/state`, `apps/web/src/app`

**Deliverables**

- `document` store: the open score, history, dirty flag, file identity; `selection` store; `playback` store mirroring engine state and position.
- Open flow: drag-and-drop anywhere, File → Open, the palette; bytes to `formats.read` to the store; warnings shown in a non-blocking toast with a details drawer.
- Layout computed in a memoized selector from the score, view options and dirty bars; the painter subscribes to it.
- The audio engine instantiated once, `load` called on score change, position events feeding the playback store.

**Acceptance criteria**

- Opening each fixture shows it and `load` completes; dropping a second file replaces the first and memory reports eviction.

## WP-051: Transport bar

- **Size**: M · **Blocked by**: WP-050
- **Packages**: `apps/web/src/features/transport`

**Deliverables**

- Play/pause, stop, position readout (bar and beat, elapsed time), tempo control with a BPM field and a percent slider linked both ways, loop toggle with the range from the selection, count-in toggle, metronome toggle with volume, master volume.
- Shortcuts registered through the command registry: space, enter for stop, bracket keys for tempo, L for loop, and so on, mirroring Guitar Pro where it has one.

**Acceptance criteria**

- Every control has a palette entry and a shortcut; RTL tests for the tempo linkage.

## WP-052: Track sidebar and mixer

- **Size**: M · **Blocked by**: WP-050
- **Packages**: `apps/web/src/features/tracks`

**Deliverables**

- The track list with color, name, mute, solo, a compact volume slider, the notation-mode toggle, and selection of the "current" track; a single-track view toggle.
- The mixer panel with volume, pan, mute, solo per track, the instrument override (GM program picker now, HQ pack in phase 3) and master volume.

**Acceptance criteria**

- Changes reach the engine immediately and persist per song once the library exists (hook left for WP-060).

## WP-053: Cursor following and seek

- **Size**: S · **Blocked by**: WP-051
- **Packages**: `apps/web/src/features/score`

**Deliverables**

- The cursor overlay driven by position events; auto-scroll that keeps the cursor in view in both view modes with a "page turn" behaviour in paged mode and a smooth scroll in continuous mode; click on a bar to seek, click on a beat to seek precisely.
- Selection of a bar range by click and shift-click or drag, feeding the loop.

**Acceptance criteria**

- Playing the long fixture keeps the cursor visible for its whole length in both modes.

## WP-054: Real-file correctness pass

- **Size**: M · **Blocked by**: WP-053, WP-027, WP-035, WP-041
- **Packages**: any, as bugs dictate

**Deliverables**

- A checklist run through Tomer's downloaded tabs in `local-tabs/`: every file opens, repeats and jumps play in the right order, tempo changes apply, effects sound right, nothing overlaps on screen. Each defect becomes a `type:bug` issue tagged with the lane, fixed by the lane or the lead depending on size.
- The checklist itself committed as `docs/reference/player-checklist.md` for reuse at later checkpoints.

**Acceptance criteria**

- The checklist passes on every local tab, with any remaining exceptions listed as issues.

## WP-055: End-to-end player flows

- **Size**: S · **Blocked by**: WP-053
- **Packages**: `apps/web/e2e`

**Deliverables**

- Playwright against the Electron build: open a fixture, play two seconds and assert the cursor moved, set a loop and assert position wraps, change tempo, mute a track, print to PDF.
- CI job for e2e on pull requests touching `apps/`.

**Acceptance criteria**

- Green in CI on macOS runners.

## WP-056: Phase 3 fan-out preparation

- **Size**: S · **Blocked by**: WP-054
- **Packages**: `apps/web`, `docs`

**Deliverables**

- Feature folders for phase 3 created with their ownership recorded; the shared store slices phase 3 needs (library identity on the document, practice session state, editing mode flag) added to `apps/web/src/state` by the lead; routes for library, trainer panels and the sound manager stubbed.
- Phase 3 contract review: any `type:contract` issues raised during phase 2 resolved and the architecture doc updated.
- The player checkpoint declared in the roadmap with the measured budgets.

**Acceptance criteria**

- Each phase-3 lane can start from its first work package without touching shared state.

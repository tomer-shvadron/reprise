# Phase 1: Model core `[S]`

Serial, done by the lead. Exit condition: the contracts in `../specs/architecture.md` are implemented in `@reprise/model` with tests, and declared frozen. After this phase, a change to the model is a `type:contract` issue, never lane work.

This phase is serial on purpose. The three phase-2 lanes all code against the model; if it were built in parallel with them, each lane would evolve its own idea of what a beat is and integration would be a rewrite.

---

## WP-010: Score model types

- **Lane**: lead · **Size**: L · **Blocked by**: WP-001
- **Packages**: `packages/model`

**Deliverables**

- The types from `../specs/architecture.md` as the package's public API: `Score`, `MasterBar`, `Track`, `Bar`, `Voice`, `Beat`, `Note`, `ChordDiagram`, with every field documented in one line where its meaning isn't obvious from the name.
- Zod schemas mirroring every type, used by the native format for validation and by tests for fixture building. The TypeScript types are derived from the schemas so they cannot drift.
- ID generation (`newId()`), a `createEmptyScore()` factory producing one fretted track with standard tuning and one empty bar, and `createTrack(kind, options)`.
- Invariants, as functions that return a list of violations: every track has as many bars as there are master bars; every voice's beats sum to the bar length or less (incomplete bars are allowed, overfull are not); note strings are within the track's string count; tie targets exist.
- Guitar Pro string numbering (1 = highest pitched) is used throughout and documented in `docs/reference/glossary.md`.

**Acceptance criteria**

- Schemas and types round-trip: a `Score` built in a test validates, and a score with a wrong field fails with a path.
- Invariant tests for each rule, positive and negative.
- No runtime dependency other than Zod and the ID generator.

---

## WP-011: Timing and playback order

- **Lane**: lead · **Size**: M · **Blocked by**: WP-010
- **Packages**: `packages/model`

**Deliverables**

- Tick arithmetic at 960 PPQ: `beatTicks(beat)` with dots and tuplets, `barTicks(masterBar)`, `beatStartTicks(voice, index)`, and `tickOf(score, { bar, beat })` as absolute score position in written order.
- `expandPlaybackSequence(score)`: the ordered list of `{ masterBarIndex, passIndex }` honouring repeat starts and ends with counts, alternate endings, segno, coda, double coda, D.S. al Coda, D.S. al Fine, D.C. al Coda, D.C. al Fine, Fine, To Coda. Defensive against malformed files: an unmatched repeat end repeats from the start of the song or the last repeat start; a jump with no target is ignored with a warning rather than a loop.
- `tempoMap(score, sequence)`: maps every bar pass to a start time in seconds, honouring tempo changes on master bars and beat-level mixer tempo changes.
- Reverse lookups: `positionAtSeconds(map, t)` returning bar pass, beat and fractional progress, which the cursor and the fretboard use.

**Acceptance criteria**

- Unit tests with hand-built scores for each repeat and jump form, including nested-looking cases from real files (repeat inside a D.S. section, a volta that is also the last bar).
- A property test: the sequence length is finite and bounded by a multiple of the bar count for any input the fuzzer builds.
- Tempo map tests with a tempo change mid-song and a 3/4 to 4/4 change.

---

## WP-012: Commands and history

- **Lane**: lead · **Size**: M · **Blocked by**: WP-010
- **Packages**: `packages/model`

**Deliverables**

- `Command` and `History` per the architecture contract, implemented on Immer with patches enabled. `apply` returns the new score and a `Change` with forward and inverse patches and the set of touched bar IDs, computed from the patch paths.
- Grouping: `beginGroup(label)` / `endGroup()` so a multi-step edit such as "paste four bars" is one undo step. Nested groups flatten.
- A first set of commands that the phase-2 lanes and the phase-3 editor need: `setNote`, `removeNote`, `insertBeat`, `removeBeat`, `setBeatDuration`, `setBeatRest`, `insertBar`, `removeBar`, `setMasterBar` (time, key, tempo, repeats, voltas, jump, section), `setTrackProperties`, `addTrack`, `removeTrack`, `moveTrack`, `setNoteEffect`, `setBeatEffect`, `transposeSelection`, `shiftStrings`. Each is a pure function on a draft; none touches UI concerns.
- `touchedBars` is what layout uses to re-flow incrementally; the rule for which bars a patch touches is documented in the module header.

**Acceptance criteria**

- Every command has a test that applies it, undoes it and asserts deep equality with the original score, and redoes it and asserts equality with the applied score.
- A grouped edit undoes in one step.
- Memory test: a thousand single-note edits on the long fixture keep the history under a stated byte budget (patches, not snapshots).

---

## WP-013: Native format

- **Lane**: lead · **Size**: M · **Blocked by**: WP-010
- **Packages**: `packages/model`

**Deliverables**

- `.reprise` as JSON: `{ format: 'reprise', version: 1, score, app: { name, version } }`. Serialisation is stable (sorted keys where order doesn't matter) so diffs are readable.
- `serialize(score)` and `parse(bytes)` with Zod validation and a migrations table keyed by version, starting with an identity migration for version 1 so the mechanism exists from day one.
- A compact variant decision: plain JSON, no compression, documented as such; the files are small and readable diffs matter more.

**Acceptance criteria**

- Round-trip tests over every fixture score built in tests and, once WP-040 lands, over every imported fixture.
- A version-0 document (fabricated) fails with a clear error; a future-version document fails with "newer than this app".

---

## WP-014: Pitch and tuning utilities

- **Lane**: lead · **Size**: S · **Blocked by**: WP-010
- **Packages**: `packages/model`

**Deliverables**

- `midiNote(track, note)` with tuning and capo; drum tracks return the note's MIDI value directly; pitched tracks the same.
- Standard tunings table (E standard, drop D, Eb standard, D standard, DADGAD, open G, open D, 7-string, 4 and 5-string bass) with names, for the track properties dialog and the tuner.
- Spelling: given a MIDI note and a key signature, the staff position and accidental for standard notation, preferring the key's accidentals; a `respell` helper for enharmonics.
- `transpose(track, note, semitones)` (track-first since WP-015, like `midiNote`) that re-fingers on the same string where possible and reports when a note falls off the fretboard.
- GM percussion map: MIDI note to drum instrument name and default staff position and note head, for the drum staff.

**Acceptance criteria**

- Table-driven tests for pitch, spelling in every key, and transposition edge cases (open string, fret 24, capo 7).

---

## WP-015: Model documentation and fixture builders

- **Lane**: lead · **Size**: S · **Blocked by**: WP-011, WP-012, WP-013, WP-014
- **Packages**: `packages/model`, `docs/reference`

**Deliverables**

- `docs/reference/score-model.md`: the model explained for humans, with a diagram of the containment hierarchy, the string-numbering convention, the tick convention, how repeats and jumps expand, and the list of commands.
- A test-utilities entry point `@reprise/model/testing` with builders: `score().track('guitar').bar().beat('8', [note(1, 0), note(2, 1)])...build()`, used by every lane's tests so fixtures are readable.
- The architecture contract marked **frozen** with the date, in `../specs/architecture.md`.

**Acceptance criteria**

- Each phase-2 lane plan can be read against the model doc without opening the source.
- Builders have their own tests.

# The score model

`@reprise/model` is the data every other package reads and writes: the score, its timing, its edits, its file format and its pitch helpers. This note explains it for someone who has not opened the source. The exact types are in [`../specs/architecture.md`](../specs/architecture.md) ("Contracts"); the record of why each modelling decision was made, and what was rejected, is the package [README](../../packages/model/README.md). Everything named here is exported from the package root, `@reprise/model`, except the test builders, which are `@reprise/model/testing`.

The contract is frozen as of WP-015 (2026-11-05). A change to anything below is a `type:contract` issue owned by the lead, never a side effect of lane work.

## Containment

```
Score ─ id, meta (title, artist, … , notices)
├── masterBars: MasterBar[]          one per bar position, shared by every track
│     time and key signature, tempo mark, repeat, alternate endings (voltas),
│     jumps, targets, section, triplet feel, double bar, anacrusis
└── tracks: Track[]                  kind: fretted | drums | pitched
      tuning, capo, fretCount, program, bank, channel, display, sound, lyrics (raw block)
      └── bars: Bar[]                one per master bar, same index
            clef?                    a clef change from this bar on
            └── voices: [Voice, Voice, Voice, Voice]   always four; unused ones are empty
                  └── beats: Beat[]
                        duration, dots, tuplet?, rest
                        text?, chord? { name, diagram? }, effects, mix?, lyrics?
                        grace?: GraceBeat[]  { duration, before, notes: Note[] }
                        └── notes: Note[]
                              string, fret, tie, articulations, accidental?
```

- **Master bar versus bar.** Anything that is the same for every instrument at a bar position (time signature, repeats, tempo marks, sections) lives on the `MasterBar`. A track's `Bar` at the same index holds only that instrument's content. `score.tracks[t].bars[i]` always pairs with `score.masterBars[i]`.
- **Ids.** Every `Score`, `MasterBar`, `Track`, `Bar`, `Voice`, `Beat` and `Note` has an `id`: 12 base62 characters from `newId()`, unique across the score. A grace beat has no id of its own; its notes do. Commands address nodes by id; timing helpers address positions by index.
- **Optional fields are exact.** An absent optional field means "not set"; an explicit `undefined` is rejected by the schemas. Commands remove an optional field with `null`.
- **Chords.** `Beat.chord.name` alone is a chord symbol written above the beat; `diagram` adds the grid (`baseFret`, one absolute fret per string from string 1, `null` muted, 0 open, optional `barres` and `fingering`).
- **Grace notes** are `Beat.grace`, an array of grace beats (16th, 32nd or 64th), played `before` the beat's time or on it. Their connection to the main note uses ordinary note fields: a slide or bend on the grace note, `hammerPull` on the main note.
- **Lyrics** exist twice. `Track.lyrics` is Guitar Pro's raw block (up to five lines of `{ startBar, text }`, `startBar` 0-based), kept for lossless import and export. `Beat.lyrics` is what layout draws: one syllable per line, index = line, `''` where a line has nothing on that beat.
- **Mixer changes** (`Beat.mix`) are mid-song changes of program, volume, pan, chorus, reverb, phaser, tremolo and tempo, each with an optional transition `duration` in beats (quarter notes for tempo); absent is immediate.

The empty score (`createEmptyScore()`) is one fretted track in E standard, one 4/4 bar at 120 BPM, and four empty voices. Factories (`createTrack(kind, options)`, `createMasterBar`, `createBar`, `createBeat`, `createNote`, `createVoice`, `createScoreMeta`) fill every required field with its default.

## Track kinds and string numbering

| Kind      | `Note.string`                  | `Note.fret`        | Tuning                                                  | Default display                               |
| --------- | ------------------------------ | ------------------ | ------------------------------------------------------- | --------------------------------------------- |
| `fretted` | 1 = highest-pitched string     | fret, 0 to `fretCount` | open-string MIDI notes, **lowest string first**, up to 10 | tab, treble clef, `octaveShift` 1             |
| `drums`   | always 0                       | the GM percussion MIDI note | empty; `capo` and `fretCount` 0               | standard, percussion clef, `octaveShift` 0    |
| `pitched` | always 0                       | the MIDI note      | usually empty; a GP5 keyboard part keeps its tuning for export | standard, treble clef, `octaveShift` 0 |

- **String 1 is the highest-pitched string**, as in Guitar Pro, but `Track.tuning` runs low to high, so string `s` sounds `tuning[tuning.length - s]` when open. On a six-string guitar string 6 is the low E (`tuning[0]`, MIDI 40) and string 1 the high E (`tuning[5]`, MIDI 64).
- **Frets count from the capo**, as Guitar Pro writes them: the sounding note is `open + capo + fret`. The ceiling a note may sit on is `fretCount` (24 by default) whatever the capo, which is what Guitar Pro files hold.
- Drums play on the GM percussion channel because of `kind`; the model stores no MIDI channel. On a drum track `program` picks the GM2 kit.
- Channel settings and mixer values are MIDI controller units, 0 to 127, pan 64 = centre.

## Rhythm and ticks

- **`PPQ` is 960**: a quarter note is 960 ticks, a whole note 3840.
- `Beat.duration` is the note value as a denominator: 1 whole, 2 half, 4 quarter, down to 256. `dots` is 0 to 2. `tuplet: { n, of }` is `n` notes in the time of `of` (a triplet is `{ n: 3, of: 2 }`); the ratio must lie strictly between 1:2 and 2:1 and not be 1:1.
- `beatTicks(beat) = 3840 / duration × (2 − 1/2^dots) × of / n`. **Ticks are never rounded**: a sixteenth septuplet is 960 / 7. Comparisons use a tolerance; only code that needs integers (MIDI export) rounds, at its own boundary.
- `barTicks(masterBar)` is the written length from the time signature. `playedBarTicks(score, i)` is how long the bar lasts in playback: the written length, except an **anacrusis** (pickup) bar lasts as long as its longest voice in any track. A short ordinary bar still lasts its full written length.
- A voice may hold **less** than the bar (incomplete bars are allowed) but never more (`voice-overfull`). A beat with `rest: false` and no notes is Guitar Pro's "empty beat", an unfilled slot rather than a rest.
- Positions in **written order** (ignoring repeats): `beatStartTicks(voice, index)` is a beat's offset in its bar (`beats.length` gives the voice's end); `tickOf(score, { bar, beat?, track?, voice? })` is the absolute tick; `barStartTicks(score)` is the prefix sum of every bar's start, with the score's end as the last entry.

## Repeats, voltas and jumps

`expandPlaybackSequence(score)` turns written order into **playback order**: `{ sequence: { masterBarIndex, passIndex }[], warnings }`. `passIndex` counts the earlier plays of the same master bar, from 0. The scheduler and the cursor follow the sequence; layout shows written order.

- **Repeats.** `repeat.start` opens a section. `repeat.endCount` is the section's **total** plays (2 = play twice); 0 is no repeat end and 1 is a repeat end that does not repeat. A second repeat end after a completed one returns to the same start (`|: A :| B :|` plays A A B A A B). A repeat start always opens a new section: there are no nested repeats.
- **Alternate endings** (voltas) are numbers 1 to 8. **Every bar of a bracket carries its numbers**, not only the first (readers propagate them). Inside a repeated section a volta bar plays only on the passes it lists; a skipped volta bar's repeat end is still read, its jumps are not.
- **Jumps** (`MasterBar.jumps`) are read at the end of a played bar, after its repeat is exhausted; **targets** (`MasterBar.targets`) are where they land: `segno`, `segnoSegno`, `coda`, `doubleCoda`, `fine`. D.C. returns to bar 1, D.S. to the nearest segno (backwards, then forwards), D.S.S. to the segno segno. The plain forms then play to the end, `al Fine` stops after the first played bar carrying `fine`, `al Coda` and `al Double Coda` take the next `toCoda` or `toDoubleCoda` to the coda. Fine and To Coda are ignored the first time through.
- **After a D.C. or D.S., repeats are not taken** and each volta run plays only its highest-numbered ending; repeats count again from a coda on.
- **Every input is finite.** Each jump fires at most once; a jump with no target is ignored with a `jump-target-missing` warning; an unmatched repeat end repeats from the song start (or the last coda landed on) with `repeat-end-without-start`; a volta bar outside any repeat plays with `volta-without-repeat`; and a backstop of `PLAYBACK_LENGTH_FACTOR` (64) passes per master bar ends the sequence with `sequence-truncated`.

alphaTab is the oracle the expander was checked against, and Guitar Pro's own order wins over both. Where this package knowingly differs from alphaTab:

| Case                                         | Here                                     | alphaTab                                    |
| -------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| D.S. or D.C. on a bar with a repeat end      | taken on the last pass, after the repeat | taken on the first pass, before it          |
| Voltas after a D.C. or D.S.                  | only the final ending of each run        | every volta bar                             |
| Jumps on a skipped volta bar                 | not read                                 | read                                        |
| A jump instruction                           | fires once                               | no guard; a D.S. after a coda loops         |
| Unmatched repeat end after landing on a coda | repeats from the coda, with a warning    | ignored                                     |
| Nested repeat starts `\|: A \|: B :\| C :\|` | A B B C B B C: the latest start wins     | A B B C A B B C                             |
| Voltas in a section with several repeat ends | numbered by the last repeat end taken    | numbered by the next repeat end             |
| `Beat.mix.tempo.duration`                    | a linear ramp in BPM                     | a step at the beat                          |
| Seconds                                      | exact                                    | each bar truncated to whole milliseconds    |

The reasons for each row are in the README's "Deviations from alphaTab".

## Tempo map

`tempoMap(score, sequence)` gives every pass of the sequence its `startTick` (ticks since playback began, counting every pass), `ticks`, `startSeconds`, `durationSeconds` and `segments` of constant or linearly ramped tempo.

- **BPM is always quarter notes per minute.** `TempoMark.unit` only records the note value a mark is displayed against: "dotted quarter = 80" is `{ bpm: 120, unit: 'dottedQuarter' }`.
- Playback starts at `DEFAULT_BPM` (120) unless the first bar has a mark, and `validateScore` requires one there. `MasterBar.tempo` applies at the bar's start, `Beat.mix.tempo` at its beat (collected from every track and voice; the first wins where two disagree at one tick).
- **Tempo carries in playback order**: a repeat or a D.C. back to an unmarked bar keeps the tempo playback had reached.
- A `Beat.mix.tempo` with a `duration` ramps linearly in BPM from the tempo in effect to its own over `duration` quarter notes, across bar lines if needed; without one it is a step.

Lookups:

- `secondsAt(map, sequenceIndex, tick)`: seconds at `tick` ticks into a pass.
- `secondsAtTick(map, playbackTick)`: the same from a playback tick (`startTick` + tick), for the scheduler; clamped to the map.
- `positionAtSeconds(map, seconds, { track?, voice? })`: the inverse, clamped to the map and `undefined` only for an empty one. It returns `sequenceIndex`, `masterBarIndex`, `passIndex`, `tick` (into the pass), `playbackTick`, `barProgress` (0 to 1), `beatIndex` (the sounding beat in that track and voice, `undefined` when the voice is empty) and `beatProgress`.

## Commands and history

Every edit is a `Command` (`{ name, run(draft, warn) }`) that mutates an Immer draft. `applyCommand(score, command)` returns `{ score, change, warnings }`, where `change` is `{ command, patches, inverse, touchedBars }`. `createHistory()` wraps it with `apply`, `undo`, `redo`, `beginGroup(label)` / `endGroup()` (one undo step; nested groups flatten), `canUndo`, `canRedo`, `undoLabel`, `redoLabel` and `steps`. Undo and redo replay patches, so a history step costs what it changed, not a copy of the score.

- **Results are frozen.** Immer freezes every result and, with it, the input it shares nodes with. Build a score, hand it to a history, and edit it only through commands. `apply` must be given the score the history last returned.
- **`touchedBars`** are master-bar ids: the columns layout re-flows. A patch inside `tracks/t/bars/b` or `masterBars/m` touches that column; a track property layout draws touches every column (`channel`, `sound`, `program`, `bank` and the raw `lyrics` touch none); `meta` touches none. A removed bar is listed with the bar that took its place; bars that only shifted are not.
- **Refusal.** A command that would break the schema or add a `validateScore` violation throws `CommandError` (`code`, `command`, and `violations` for `invariant`) and nothing is applied. Violations an imported file already carried do not block unrelated edits.
- **Repair.** A tie whose origin an edit removes or moves to another pitch is released rather than refused.
- **Warnings** (`Applied.warnings`, each `{ code, noteId, message }`) report what an applied edit changed beyond what was asked: today `trill-dropped` and `natural-harmonic-moved` from `transposeSelection`. Undo and redo report none.
- **Addressing** is by id. Commands that create a node take an optional `id`. Grace notes are reached through their beat. A `Selection` is `{ beatIds?, noteIds? }`: the notes picked, plus every note (grace notes included) of the beats picked.

| Command                                     | What it does                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setNote({ beatId, id? }, note)`            | Replaces the note on the same string (same MIDI value off fretted tracks) or adds one; a rest becomes a played beat. A new fret carries along its tie chain; on a tied note it releases the tie. |
| `removeNote({ noteId })`                    | Removes a note; a beat left without notes becomes a rest.                                                                                                                     |
| `setNoteEffect({ noteId }, changes)`        | Any note field but id, string and fret.                                                                                                                                       |
| `transposeSelection(selection, semitones)`  | Moves each note through `transpose`, staying on its string; tie chains move with their origin; drum and dead notes stay; refuses notes that fall off the neck.               |
| `shiftStrings(selection, 'higher' \| 'lower')` | Moves notes to the neighbouring string at the same pitch; refuses occupied strings and frets off the neck.                                                                  |
| `insertBeat({ voiceId, index, id? }, beat)` | A quarter rest by default; refuses to overfill the voice or place a note off the neck.                                                                                        |
| `removeBeat({ beatId })`                    | Removes a beat.                                                                                                                                                               |
| `setBeatDuration({ beatId }, rhythm)`       | Duration, dots, tuplet; refuses to overfill the voice.                                                                                                                        |
| `setBeatRest({ beatId }, rest)`             | `true` makes a rest and drops the notes; `false` leaves an empty beat.                                                                                                        |
| `setBeatEffect({ beatId }, changes)`        | Beat effects, text, chord, lyrics, mixer change and grace notes.                                                                                                              |
| `insertBar({ index, id? }, masterBar?)`     | An empty bar in every track; copies the previous bar's signatures and triplet feel and the following bar's voltas; at index 0 takes over the tempo mark; shifts `Track.lyrics`. |
| `removeBar({ masterBarId })`                | Removes the column from every track; its tempo mark moves to the next bar when that has none; a score keeps one bar.                                                         |
| `setMasterBar({ masterBarId }, changes)`    | Time, key, tempo, repeats, voltas, jumps, targets, section, anacrusis, triplet feel, double bar; refuses a signature that would overfill a voice.                             |
| `setTrackProperties({ trackId }, changes)`  | Everything but id, kind and bars; `channel` and `display` merge; refuses a tuning or fret count that strands notes.                                                           |
| `addTrack({ kind, index?, id? }, props)`    | A track of empty bars, one per master bar.                                                                                                                                    |
| `removeTrack({ trackId })`                  | A score keeps at least one track.                                                                                                                                             |
| `moveTrack({ trackId }, index)`             | Moves a track to `index` in the final order.                                                                                                                                  |

## Invariants

The schemas (`ScoreSchema` and one per node) check shape and per-field ranges. `validateScore(score)` checks what spans fields or nodes and returns `Violation[]` (`{ rule, path, message }`, `path` from the score root); it is linear in the score.

| Rule                              | What it checks                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `duplicate-id`                    | Every id is unique across the score.                                                                                         |
| `first-bar-tempo`                 | The first master bar carries a tempo mark.                                                                                   |
| `bar-count`                       | Every track has one bar per master bar.                                                                                      |
| `track-kind`                      | Fretted tracks have strings and frets; drum tracks have no tuning, capo or frets.                                            |
| `voice-overfull`                  | A voice's beats sum to at most the bar length.                                                                               |
| `rest-with-notes`                 | A rest carries no notes.                                                                                                     |
| `string-range`                    | Fretted notes use strings 1 to the string count; drum and pitched notes use string 0.                                       |
| `fret-range`                      | Fretted notes sit on frets 0 to `fretCount`.                                                                                 |
| `duplicate-string`                | No two notes of a fretted beat share a string.                                                                               |
| `tie-target`                      | A tied note has a note on the same string (same MIDI note off fretted tracks) in the previous beat of its voice, across bar lines. |
| `tie-pitch`                       | A tied fretted note is on the same fret as the note it continues.                                                            |
| `tuplet`                          | `n:of` is not 1:1 and lies strictly between 1:2 and 2:1.                                                                     |
| `dots`                            | 0 to 2 dots.                                                                                                                 |
| `chord-diagram`                   | A diagram on a track with strings has one fret per string, fingering to match, barres in range.                              |
| `alternate-ending-order`          | Volta numbers on a bar are unique and ascending.                                                                             |
| `alternate-ending-outside-repeat` | Every run of consecutive volta bars contains a repeat end.                                                                   |

## Diagnostics

Every diagnostic identifier is kebab-case. An invariant violation keys its kind as `rule` (`Violation`); a warning or an error keys it as `code` (`ParseWarning`, `PlaybackWarning`, `CommandWarning`, `CommandError`, `NativeFormatError`). Model enum values (`slight`, `doubleFlat`, `belowOpenString`) are camelCase: they are data a file carries, not something reported about it.

## Native format

A `.reprise` file is UTF-8 JSON: `{ format: 'reprise', version, app: { name, version }, score }`, in that key order.

- `serializeNative(score, app)` returns `Uint8Array` bytes. Every object inside `app` and `score` is written with sorted keys and two-space indentation, so the bytes depend only on content and diffs stay readable. No compression, deliberately. Writing validates against `NativeDocumentSchema` and throws `NativeFormatError` (with a `path`) rather than writing a file that cannot be read; it does not run `validateScore`.
- `parseNative(bytes)` returns `{ score, app, warnings }` or throws `NativeFormatError` (`code` and `path`): `invalid-utf8`, `invalid-json`, `wrong-format`, `invalid-version`, `newer-version` (above `SCORE_VERSION`: "newer than this app"), `migration-failed` or `invalid-document`. Unknown fields are dropped and reported (`code: 'unknown-field'`), and invariant violations are reported as warnings with their rule as the `code`, with paths from the document root (`score.tracks[0]…`).
- **The envelope's `version` is the only schema version.** `MIGRATIONS[n]` turns a version-`n − 1` score into version `n`, on plain JSON; version 1 is the identity. `Score` itself carries no version.

## Pitch and spelling

- `midiNote(track, note)` is the sounding MIDI note: `tuning[tuning.length − string] + capo + fret` on fretted tracks, `note.fret` on drum and pitched tracks. `openStringPitch(track, string)` is the open string without the capo.
- `transpose(track, note, semitones)` moves a note on its own string and returns `{ ok: true, note, warnings }` or `{ ok: false, reason, midi, alternatives }` (`belowOpenString`, `aboveLastFret`, `outOfMidiRange`; `alternatives` are other strings that can play the pitch). Drum notes come back unchanged. The trill's alternate fret moves too and is dropped with `trill-dropped` if it falls off; a natural harmonic warns `natural-harmonic-moved`.
- `STANDARD_TUNINGS` names fourteen tunings (guitar, 7-string, 4- and 5-string bass, ukulele) and `findTuningName(tuning)` matches one exactly.
- **Written octave.** `Track.display.octaveShift` is written minus sounding pitch in octaves: 1 on fretted tracks, since guitar and bass are written an octave above where they sound, 0 on drum and pitched tracks.
- **Spelling.** `spell(midi, key, accidental?)` returns `{ letter, octave, alter, accidental? }`; `spellNote(track, note, key)` does it from a note. `octave` is scientific (C4 = 60) and belongs to the letter, so B#3 is MIDI 60. The returned `accidental` is what to print against the key signature; cancelling an accidental earlier in the bar is layout's job. The policy follows Guitar Pro: a stored accidental that can spell the pitch wins, then the key's own notes, then a minor key's raised sixth and seventh, then the natural letter, then a **sharp in C major and the sharp keys** or a flat in the flat keys.
- **`Note.accidental` is the alteration of the spelling**, not the printed sign: `flat` means a lowered letter, whatever the key prints. Absent means "spell from the key". `respell(track, note, key)` flips to the enharmonic (C# and Db, E and Fb, B and Cb; D, G and A cycle through double sharp and double flat) and clears the stored accidental when the result is the key's default.
- `staffPosition(spelling, clef, octaveShift = 0)` is the line or space on a five-line staff: 0 the bottom line, 8 the top line, odd numbers spaces, beyond them ledger positions. Pass the track's `octaveShift`, so a guitar's sounding E2 sits where E3 is written.
- `percussionInstrument(midi)` gives the GM and GM2 drum name, default staff position (same numbering) and note head (`normal`, `cross`, `diamond`, `triangle`) for MIDI 27 to 87.

## Test builders

`@reprise/model/testing` is the one subpath other packages may import, and only from test files.

```ts
import { midi, note, score } from '@reprise/model/testing';

const built = score()
  .title('Riff')
  .tempo(96)
  .timeSignature(3, 4)
  .track('guitar')
  .bar()
  .repeatStart()
  .section('Verse')
  .beat('8', [note(1, 0), note(2, 1)], { effects: { pickStroke: 'down' } })
  .rest('2')
  .bar()
  .beat('2.', [note(6, 3)])
  .volta([1])
  .repeatEnd(2)
  .track('drums')
  .bar()
  .beat('4', [midi(36)])
  .build();
```

- Score-level calls (`title`, `artist`, `meta`, `id`, and `tempo`, `timeSignature`, `key` before any bar) set defaults. `track(instrument, spec)` starts a track (`guitar`, `bass`, `drums`, `piano`); `bar()` opens its next bar (or, before any track, a master bar with no content); the first `beat()` opens one if none is. `voice(n)` switches voice.
- Master-bar calls (`tempo`, `timeSignature`, `key`, `repeatStart`, `repeatEnd(plays = 2)`, `volta`, `section`, `jump`, `target`, `anacrusis`, `masterBar(changes)`) apply to the open bar's column, shared by every track. A new master bar copies the previous one's signatures.
- Durations: `'8'` eighth, `'4.'` dotted quarter, `'2..'` double-dotted half, `'8t'` triplet eighth; any other tuplet goes in the spec (`beat('8', notes, { tuplet: { n: 5, of: 4 } })`). `note(string, fret, spec?)` for fretted tracks, `midi(value, spec?)` for drum and pitched ones; ids may be given wherever a test needs them.
- `build()` pads short tracks, adds a guitar if no track was declared, gives the first bar the builder's default tempo if it has no mark (`tempo()` before any bar, 120 otherwise), then checks the schema and `validateScore` and throws `ScoreBuildError` (with `violations`). `build({ validate: false })` skips the invariants, for tests of invalid scores. `build({ ids: 'sequential' })` numbers every node in document order with kind-prefixed ids (`score0000001`, `mbar00000001`, `track0000001`, `bar000000001`, `voice0000001`, `beat00000001`, `note00000001`), keeping the ids a test gave, so two builds of one chain deep-equal and a data snapshot keyed by node id (layout's anchors) stays put; by default ids are random, as in a real score.
- `fullScore()` is a valid score that sets every node type and optional field; `largeScore(tracks, bars, { structure? })` is the generated score for performance and memory tests; `beatOf(score, track, bar, beat, voice = 0)` and `noteOf(score, track, bar, beat, note = 0, voice = 0)` find nodes by index.

## Not modelled in v1

Readers drop these with a warning; each would be a contract change.

- Song: RSE settings, page setup, master volume and reverb, hidden tempo marks, MIDI ports and channels.
- Track: 12-string and banjo flags, tuning labels and flat display, partial capo, ottava lines and chromatic transposition (`octaveShift` covers whole octaves), multiple staves per track (collapsed onto one by ADR-0006).
- Bar: GP5 beam grouping, fermatas, free time, simile marks (readers copy the previous bar's beats instead), stem orientation overrides.
- Beat: hairpins, legato slurs, slashed beats, timers, golpe, dead slap, rasgueado, wah, nested tuplets, note duration percentage.
- Note: tenuto and staccatissimo, left-hand tapping, ornaments, the vibrato byte on GP5 bend points, the chord wizard's construction data.
- Rhythm: double and quadruple whole notes.

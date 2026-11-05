# @reprise/model

The score model every other package codes against: Zod schemas with the TypeScript types
derived from them (`z.infer`), node factories, `newId()`, and `validateScore()`. The root
export (`src/index.ts`) is the public API. Zod is the only runtime dependency.

```ts
import { ScoreSchema, createEmptyScore, validateScore } from '@reprise/model';

const score = createEmptyScore();
ScoreSchema.parse(score); // shape and per-field ranges
validateScore(score); // cross-node invariants: [] when the score is sound
```

## Two layers of checking

- **Schemas** check shape and per-field ranges only, and carry no refinements, so they stay
  plain `ZodObject`s that can be picked, extended and introspected.
- **`validateScore(score)`** checks what spans fields or nodes and returns `Violation[]`
  (`{ rule, path, message }`, with `path` in Zod's issue-path shape from the score root).
  It assumes schema-valid input. It is linear in the score: 8 tracks by 300 bars with 38,400
  notes validate in about 20 ms (`large-score.test.ts`).

| Rule                              | What it checks                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicate-id`                    | Every id is unique across the score.                                                                                                                     |
| `bar-count`                       | Every track has one bar per master bar.                                                                                                                  |
| `track-kind`                      | Fretted tracks have strings and frets; drum tracks have no tuning, capo or frets.                                                                        |
| `voice-overfull`                  | A voice's beats sum to at most the bar length. Incomplete bars are allowed.                                                                              |
| `rest-with-notes`                 | A rest carries no notes.                                                                                                                                 |
| `string-range`                    | Fretted notes use strings 1 to the string count; drum and pitched notes use string 0.                                                                    |
| `duplicate-string`                | No two notes of a fretted beat share a string.                                                                                                           |
| `tie-target`                      | A tied note has a note on the same string (same MIDI note on drum and pitched tracks) in the previous beat of its voice, crossing into the previous bar. |
| `tuplet`                          | `n:of` is not 1:1 and lies strictly between 1:2 and 2:1.                                                                                                 |
| `dots`                            | 0 to 2 dots (defensive, for input that bypassed the schema).                                                                                             |
| `chord-diagram`                   | A chord diagram on a track with strings has one fret per string, fingering to match, barres in range.                                                    |
| `alternate-ending-order`          | Volta numbers on a bar are unique and ascending.                                                                                                         |
| `alternate-ending-outside-repeat` | Every run of consecutive volta bars contains a repeat end.                                                                                               |

## Native format (`.reprise`)

```ts
import { parseNative, serializeNative } from '@reprise/model';

const bytes = serializeNative(score, { name: 'Reprise', version: '1.0.0' }); // Uint8Array
const { score: read, app, warnings } = parseNative(bytes); // throws NativeFormatError
```

- **Envelope**: `{ format: 'reprise', version, app: { name, version }, score }`, in that key
  order so `format` opens the file. `app` records the writer for diagnostics only.
- **Stable bytes**: every object inside `app` and `score` is written with its keys sorted, so
  the output depends only on content, never on insertion order; arrays keep their order. Two
  spaces of indentation, UTF-8, a trailing newline.
- **No compression**, deliberately: files are small, and readable diffs and hand inspection
  matter more than size. A library that wants compression applies it around these bytes.
- **Writing validates first**: `serializeNative` checks the envelope against
  `NativeDocumentSchema` and writes the validated copy, so a score the reader would reject (a
  non-finite number, a missing field) throws `NativeFormatError` with the path instead of
  becoming a file that cannot be opened, and fields the schema does not know are not written.
  It does not run `validateScore`: a score with an invariant violation still saves, and the
  reader reports the violation.
- **Reading**: UTF-8 (strict; a leading BOM is accepted and never written), JSON (`null` is
  a value, never a missing optional field), `format`, then `version`. A version below 1 or not
  a whole number fails; a version above `SCORE_VERSION` fails with "newer than this app",
  naming both versions. The `score` then runs through `MIGRATIONS` from the file's version to the current
  one, and the whole envelope is checked against `NativeDocumentSchema`. Any failure is a
  `NativeFormatError` whose `path` (and message prefix, `score.tracks[0].bars[2].id: ...`) names
  the offending field.
- **Warnings, never failures**, for what the schema cannot see: unknown fields anywhere in the
  document are dropped and reported (`rule: 'unknown-field'`), and the score's invariant
  violations (`validateScore`) are reported under their rule. Every `ParseWarning` path starts
  at the document root, so a score violation's path begins with `score`.
- **Migrations**: `MIGRATIONS[n]` turns a version-`n - 1` `score` into its version-`n` shape,
  working on plain JSON. Version 1's entry is the identity. A step that throws surfaces as a
  `NativeFormatError` naming both versions. Raising the version means: bump `SCORE_VERSION`,
  add the step, and add a fixture of the old version to the tests.
- **Test fixture**: `src/full-score.fixture.ts` builds a score using every node type for the
  package's own tests. It is not part of the public API; WP-015's `@reprise/model/testing`
  builders are the entry point for other packages' tests.

## Modelling decisions

Where the architecture sketch (`docs/specs/architecture.md`, "Score model") left a loose end:

- **One version field**: the `.reprise` envelope's `version` is the only schema version and
  the migrations key; `Score` carries none, so an in-memory score never claims a version it
  was not migrated to. `SCORE_VERSION` is the envelope's current version.
- **IDs**: `newId()` is 12 base62 characters from `crypto.getRandomValues`, with rejection
  sampling so every character is equally likely. On `Score`, `MasterBar`, `Track`, `Bar`,
  `Voice`, `Beat` and `Note`. `IdSchema` enforces the format. A grace beat has no id of its
  own; its notes do.
- **Optional fields are exact** (`z.exactOptional()`): with `exactOptionalPropertyTypes` the
  inferred type is `field?: T`, never `T | undefined`, and the schema rejects an explicit
  `undefined`. Absent always means "not set", which keeps JSON and Immer patches unambiguous.
- **String numbering**: `Note.string` 1 is the highest-pitched string, as in Guitar Pro;
  `Track.tuning` is low to high, so a string's open pitch is `tuning[tuning.length - string]`.
- **`Note.fret` on drum and pitched tracks is the MIDI note**, and `Note.string` is required
  and `0` there. Required-and-zero keeps fretted code paths free of `undefined` checks; the
  `string-range` rule enforces 1 to the string count on fretted tracks and 0 elsewhere.
- **Durations**: `duration` is the denominator, 1 (whole) to 256 as gpif's `NoteValue` allows
  (GP5 stops at 64), `dots` 0 to 2, `tuplet` `{ n, of }`. Tuplets can make tick lengths
  fractional (septuplets at 960 PPQ); `validateScore` compares tick sums with a float
  tolerance, and tick values are never rounded (see "Timing and playback order"). Double and
  quadruple whole notes are not representable; a reader ties whole notes.
- **Voices**: exactly four per bar, all present (a Zod tuple); unused voices have no beats.
- **Empty score**: one fretted track in E standard, 4/4, 120 BPM on the first master bar, and
  one bar whose four voices have no beats. A score has at least one track and one master bar.
- **Tempo**: `TempoMark` is `{ bpm, unit?, label? }`. `bpm` is always per quarter note, which is
  what the tempo map needs; `unit` only records the note value the mark is displayed against
  (gpif's five: eighth, quarter, dotted quarter, half, dotted half), so "dotted quarter = 80"
  is `{ bpm: 120, unit: 'dottedQuarter' }` and survives gp export. `MasterBar.tempo` is a
  change at the start of a bar; `Beat.mix.tempo` is the same shape plus a `duration`, for
  mid-bar changes. Nothing requires a tempo on the first master bar; WP-011 defaults to 120.
- **Repeats**: `repeat.endCount` is the total number of plays of the section (2 = play twice),
  0 = no repeat end. Readers convert from formats that store "extra repeats".
- **Jumps and targets are split**: `MasterBar.jumps` holds the instructions read at the end of
  the bar (`daCapo`, `dcAlCoda`, `dcAlDoubleCoda`, `dcAlFine`, `dalSegno`, `dsAlCoda`,
  `dsAlDoubleCoda`, `dsAlFine`, `dalSegnoSegno`, `dssAlCoda`, `dssAlDoubleCoda`, `dssAlFine`,
  `toCoda`, `toDoubleCoda`), usually none or one, applied in order when a file carries two;
  `MasterBar.targets` lists the places a jump lands on (`segno`, `segnoSegno`, `coda`,
  `doubleCoda`, `fine`). This is how GP5 and gpif store directions, and one bar can carry a
  target and a jump at once.
- **Anacrusis**: `MasterBar.anacrusis` marks a pickup bar, which the count-in skips and the
  bar numbering does not count.
- **Alternate endings** are volta numbers 1 to 8 (GP5's bitmask width). "Inside a repeat"
  means: each run of consecutive volta bars contains a repeat end, which admits the final
  volta that follows the last repeat end.
- **Triplet feel** covers gpif's set: none, eighth, sixteenth, dotted and Scottish variants.
- **Bends and whammy**: points have `position` 0 to 60 across the note's duration and `value`
  in quarter tones, Guitar Pro's units. Mapping: GP3-5 raw values / 25 (100 = one whole tone),
  gpif values / 25 likewise, gpif offsets (0 to 100) × 0.6. Each bend stores GP's `kind`
  (`bend`, `bendRelease`, `bendReleaseBend`, `prebend`, `prebendBend`, `prebendRelease`,
  `release`, `hold`, `custom` for point lists that fit none) so the renderer can label it;
  the beat-level whammy bar has its own kinds and may go negative.
- **Hammer-ons and pull-offs** are flagged on the destination note (`Note.hammerPull`), where
  playback needs them. GP5 flags the origin and gpif flags both ends, so every reader moves the
  flag to the next note on the same string in the same voice, and drops it with a warning when
  there is none.
- **Mixer changes** (`Beat.mix`): `volume`, `pan`, `chorus`, `reverb`, `phaser`, `tremolo` are
  each `{ value, duration?, allTracks? }`, `tempo` is a `TempoMark` plus `duration`, plus an
  optional `program` change. `duration` is the transition length in beats (absent = immediate).
  `allTracks` mirrors GP5's per-field "apply to all tracks" bit; tempo is global anyway. gpif's
  linear tempo ramps run from the previous automation into the new one; a reader approximates
  them as a change at the ramp's start with `duration` set to the distance.
- **Controller units**: channel settings and mixer values are MIDI controller units, 0 to 127,
  pan 64 = centre. Readers convert from Guitar Pro's 0 to 16 mixer scale (the step is about 8,
  so the conversion round-trips). `channel.mute` and `channel.solo` are the file's playback
  state, which the mixer edits in place.
- **Drums** play on the GM percussion channel by virtue of `kind: 'drums'`; the model stores no
  MIDI channel. `program` selects the GM2 drum kit (0 standard). Display: standard notation,
  percussion clef. `tuning: []`, `capo: 0`, `fretCount: 0`, enforced by `track-kind`.
- **Pitched** tracks default to standard notation, treble clef, and to no tuning, but may keep
  one: GP5 stores keyboards as stringed tracks, so a GP5 track whose program is outside the
  fretted families (GM 24 to 39, plus 104 sitar, 105 banjo, 106 shamisen, 107 koto) and whose
  channel is not percussion becomes `pitched`, its notes converted to MIDI through the file's
  tuning, and the track keeps that tuning and `fretCount` so gp5 export can re-finger it.
- **`Track.fretCount`** (new) is the neck length, 24 by default, for transposition and the
  fretboard view.
- **Chords**: `Beat.chord` is `{ name, diagram? }`. The name alone is a chord written above the
  beat, as the editor enters it; `diagram` is the grid when the file carries one: `baseFret`,
  one absolute fret per string (string 1 first, `null` = muted, 0 = open), optional `barres`
  and per-string `fingering`. The sketch's separate `chordName` and `chordDiagram` are the two
  halves of this one field. GP5 stores the diagram on the beat; gpif stores it once per track
  and references it, and the gp writer deduplicates by structural equality.
- **Lyrics** are stored twice, as the lead ruled. `Track.lyrics` is the raw Guitar Pro block:
  up to five lines of `{ startBar, text }` (`startBar` is a 0-based master-bar index; GP files
  store it 1-based), kept for lossless import and export. `Beat.lyrics` is the per-beat form
  the layout draws: one syllable per lyric line, index = line, up to five lines, `''` where a
  line has nothing on this beat. Readers fill both; writers prefer the raw block when it is
  non-empty.
- **Grace notes**: `Beat.grace` is an array of grace beats, each `{ duration, before, notes }`,
  so gpif's runs of several grace beats survive. How a grace note connects to the main note
  is expressed with ordinary note fields: a slide on the grace note, a bend on it, or
  `hammerPull` on the main note.
- **Strokes**: `effects.arpeggio` and `effects.brush` are `{ direction, duration? }`, keeping the
  stroke's speed that GP files carry.
- **Beat vibrato** is the same `'slight' | 'wide'` enum as note vibrato, replacing the
  sketch's two booleans. `fadeOut` and `volumeSwell` join `fadeIn`.
- **Fingering**: `thumb`, `index`, `middle`, `ring`, `little` for both hands; the readers map
  Guitar Pro's T 1 2 3 4 and p i m a c onto it.
- **`Note.accidental`** (new, optional) records an explicit spelling for standard notation, so
  WP-014's `respell` has somewhere to store its result; absent = spell from the key.
- **Harmonics** add `feedback` (gpif) to the sketch's kinds; `value` is the harmonic's fret,
  fractional where needed.
- **Colours** are lower-case `#rrggbb`.
- **Clefs** are `treble`, `bass`, `alto`, `tenor`, `percussion` (gpif's G2, F4, C3, C4, Neutral).

## Timing and playback order

Pure helpers over the model, all from the root export.

```ts
import { expandPlaybackSequence, positionAtSeconds, tempoMap, tickOf } from '@reprise/model';

const { sequence, warnings } = expandPlaybackSequence(score); // [{ masterBarIndex, passIndex }]
const map = tempoMap(score, sequence); // every pass with its start in seconds
positionAtSeconds(map, 12.5); // { sequenceIndex, masterBarIndex, passIndex, tick, beatIndex, ... }
```

### Ticks

- `PPQ` is 960. `beatTicks(beat)` applies dots and tuplets; `barTicks(masterBar)` is the written
  length from the time signature; `beatStartTicks(voice, index)` sums the beats before `index`
  (`beats.length` gives the voice's end).
- **No rounding.** Tick values are plain numbers and stay fractional where a tuplet makes them
  so (a sixteenth septuplet is 960 / 7). Comparisons use a tolerance; whatever needs
  integers (MIDI export) rounds at its own boundary.
- `playedBarTicks(score, index)` is how long a bar lasts in playback: the written length, except
  that an anacrusis lasts as long as its longest voice in any track (the written length when all
  are empty). A short ordinary bar still lasts its full written length.
- `tickOf(score, { bar, beat, track?, voice? })` is the absolute tick in written order, ignoring
  repeats and jumps, using `playedBarTicks`. Out-of-range positions throw a `RangeError`.

### Playback sequence

`expandPlaybackSequence(score)` returns `{ sequence, warnings }`. `passIndex` counts the earlier
plays of the same master bar, from 0. The rules, which follow alphaTab (the project's oracle)
except where noted:

- **Repeats.** A bar with `repeat.start` opens a section. At the end of a played bar with
  `endCount` n ≥ 2, playback returns to the section start until the section has been played n
  times; `endCount` 1 is no repeat. A second repeat end after a completed one returns to the same
  start, and replays the first repeat too (`|: A :| B :|` is A A B A A B), as alphaTab does.
- **Unmatched repeat end**: with no repeat start since the song start (or since landing on a
  coda), the section starts there, with a `repeat-end-without-start` warning.
- **Alternate endings.** Inside a repeat section a volta bar plays only on the passes its
  numbers list. A skipped bar's repeat end is still read, since the repeat sign closes the section
  whichever ending it sits in (as alphaTab does); its jumps are not. A volta bar with no repeat
  end ahead of it in its section always plays, with a `volta-without-repeat` warning when no
  repeat surrounds it at all. **Every bar of a bracket carries its numbers.** GP5 and gpif store
  them on the bracket's first bar only (in `fixtures/gp5/repeat-close-alternate-endings.gp5` bar
  3 sits inside the "2." bracket, carries nothing and holds the repeat close), so a reader
  propagates them from the marked bar through the bar carrying the repeat end; alphaTab inherits
  them at playback instead.
- **Jumps** are read at the end of a played bar, after its repeat end is exhausted (so a D.S. on
  a repeated bar is taken on the last pass; see "Deviations from alphaTab"). The bar's `jumps`
  are tried in order and the first that applies is taken. Each jump instruction fires at most
  once, which keeps every input finite.
  - D.C. forms land on bar 1; D.S. on the nearest `segno` searching backwards, then forwards;
    D.S.S. likewise on `segnoSegno`.
  - D.C., D.S. and D.S.S. alone play to the end; their `al Fine` forms stop after the first
    played bar carrying `fine`; their `al Coda` and `al Double Coda` forms take `toCoda` or
    `toDoubleCoda` respectively, to the nearest `coda` or `doubleCoda` searching forwards, then
    backwards. Fine, To Coda and To Double Coda are ignored on the first time through.
  - **After a D.C. or D.S. jump, repeats are not taken** (senza repetizione) and each volta run
    plays only its final ending, the highest number in the run. Repeats are honoured again from a
    coda on.
- **Malformed input.** A jump whose target is missing is ignored with a `jump-target-missing`
  warning (an `al Fine` with no `fine` anywhere still jumps, plays to the end, and warns). A
  To Coda whose coda precedes the segno is followed; it cannot loop because jumps fire once.
  As a backstop the sequence stops at `PLAYBACK_LENGTH_FACTOR` (64) passes per master bar with a
  `sequence-truncated` warning; only runaway repeat counts or many stacked repeat ends reach it.

### Deviations from alphaTab

alphaTab (`MidiPlaybackController`, `MidiFileGenerator`) is the oracle the fixtures are checked
against; these are the places this package knowingly differs, and why. Guitar Pro's own order
wins over both: WP-054 compares `fixtures/gp5/directions.gp5` and
`fixtures/gp5/repeat-close-alternate-endings.gp5` against it once the reader lands, and the
expander follows Guitar Pro wherever the two disagree.

| Case                                         | Here                                     | alphaTab                                    | Why                                                          |
| -------------------------------------------- | ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| D.S. or D.C. on a bar with a repeat end      | taken on the last pass, after the repeat | taken on the first pass, before it          | the musical convention                                       |
| Voltas after a D.C. or D.S.                  | only the final ending of each run        | every volta bar                             | the musical convention (senza repetizione)                   |
| Jumps on a skipped volta bar                 | not read                                 | read                                        | a jump inside a skipped bracket is not seen                  |
| A jump instruction                           | fires once                               | no guard; a D.S. after a coda loops there   | the finite-sequence guarantee                                |
| Unmatched repeat end after landing on a coda | repeats from the coda, with a warning    | ignored: its section's start was not passed | the plan: the song start or the last repeat start            |
| Nested repeat starts `\|: A \|: B :\| C :\|` | A B B C B B C: the latest start wins     | A B B C A B B C                             | Guitar Pro has no nested repeats; a start closes the section |
| Voltas in a section with several repeat ends | numbered by the last repeat end taken    | numbered by the next repeat end             | rare; revisited on a real file                               |
| `Beat.mix.tempo.duration`                    | a linear ramp in BPM                     | a step at the beat; `isLinear` is ignored   | the ruling on tempo transitions                              |
| Seconds                                      | exact                                    | each bar truncated to whole milliseconds    | nothing to round for                                         |

### Tempo map

`tempoMap(score, sequence)` gives every pass its `startTick` (playback ticks), `ticks`,
`startSeconds`, `durationSeconds` and constant or ramped `segments`; `secondsAt(map,
sequenceIndex, tick)` is the forward lookup and `positionAtSeconds(map, seconds, { track,
voice })` the reverse, clamped to the map (`undefined` only for an empty one), with `beatIndex`
-1 for an empty voice.

- Playback starts at `DEFAULT_BPM` (120) unless the first bar has a mark. **Tempo carries in
  playback order**: a repeat or a D.C. back to an unmarked bar keeps the tempo playback had
  reached, as a MIDI rendering of the expanded sequence does.
- `MasterBar.tempo` applies at the bar's start; `Beat.mix.tempo` at the beat's start, collected
  from every track and voice (the first track and voice win where two disagree at one tick).
  At tick 0 the beat-level change applies after the mark, so a step overrides it and a ramp
  starts from it.
- **A `duration` is a linear ramp in BPM** from the tempo in effect (mid-ramp if one is running)
  to the new tempo over `duration` quarter notes, continuing across bar lines in playback order;
  without one the change is a step. A new change cuts a running ramp short.

## Not modelled yet

Readers drop these with a warning; each is a contract change if it is ever needed. Confirmed by
the lead for the phase-1 freeze and re-checked in WP-015.

- Song level: RSE settings, page setup, master volume and reverb, hidden tempo marks, MIDI
  ports and channels, gpif `WordsAndMusic` (read into `words` and `music`).
- Track level: the 12-string and banjo flags, tuning labels and flat display, partial capo,
  ottava and transposing instruments, multiple staves per track (collapsed onto one staff by
  ADR-0006; the reader's voice-merge rule is the formats lane's).
- Bar level: GP5 beam grouping, fermatas, free time, simile marks (the reader copies the
  previous bar's beats into the bar with fresh ids, or the bar would play silent), stem
  orientation overrides.
- Beat level: hairpins, legato slurs, slashed beats, timers, golpe, dead slap, rasgueado, wah,
  nested (secondary) tuplets, note duration percentage.
- Note level: tenuto and staccatissimo, left-hand tapping, ornaments, the vibrato byte on each
  GP5 bend point, the chord wizard's construction data (root, type, extensions, omissions,
  show-fingering).
- Rhythm: double and quadruple whole notes.

# @reprise/model

The score model every other package codes against: Zod schemas with the TypeScript types
derived from them (`z.infer`), node factories, `newId()`, and `validateScore()`. The root
export (`src/index.ts`) is the public API; `@reprise/model/testing` (`src/testing/index.ts`)
holds the test builders. Zod and Immer are the only runtime dependencies. This README is the
record of decisions; [`docs/reference/score-model.md`](../../docs/reference/score-model.md)
explains the model for readers who have not seen the source, and the frozen contract is
`docs/specs/architecture.md`, "Contracts" (WP-015, 2026-11-05).

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

| Rule                              | What it checks                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicate-id`                    | Every id is unique across the score.                                                                                                                        |
| `first-bar-tempo`                 | The first master bar carries a tempo mark.                                                                                                                  |
| `bar-count`                       | Every track has one bar per master bar.                                                                                                                     |
| `track-kind`                      | Fretted tracks have strings and frets; drum tracks have no tuning, capo or frets.                                                                           |
| `voice-overfull`                  | A voice's beats sum to at most the bar length. Incomplete bars are allowed.                                                                                 |
| `rest-with-notes`                 | A rest carries no notes.                                                                                                                                    |
| `string-range`                    | Fretted notes use strings 1 to the string count; drum and pitched notes use string 0.                                                                       |
| `fret-range`                      | Fretted notes sit on frets 0 to `track.fretCount`, whatever the capo, as Guitar Pro files hold them.                                                        |
| `duplicate-string`                | No two notes of a fretted beat share a string.                                                                                                              |
| `tie-target`                      | A tied note has an origin (`tieOriginOf`): the most recent note on its string (MIDI note on drum and pitched tracks) in its voice, at most three bars back. |
| `tie-pitch`                       | A tied fretted note is on the same fret as the note it continues; off fretted tracks `tie-target` already matches by MIDI note.                             |
| `tuplet`                          | `n:of` is not 1:1 and lies strictly between 1:2 and 2:1.                                                                                                    |
| `dots`                            | 0 to 2 dots (defensive, for input that bypassed the schema).                                                                                                |
| `chord-diagram`                   | A chord diagram on a track with strings has one fret per string, fingering to match, barres in range.                                                       |
| `alternate-ending-order`          | Volta numbers on a bar are unique and ascending.                                                                                                            |
| `alternate-ending-outside-repeat` | Every run of consecutive volta bars contains a repeat end.                                                                                                  |

**Tie origins reach back three bars** (#62). Until then a tie's origin had to sit in the previous
beat, and Guitar Pro files routinely hold a bass note under a moving melody across several beats
and bar lines: the reader released each such tie, which re-struck the held note. The origin is now
the most recent note in the tied note's slot in its voice, from the previous beat back to the
start of the bar three before its own; rests and notes on other strings are passed over, and a
note on the same string in between is the origin, so it ends the hold. Three bars is alphaTab's
bound (`Note.findTieOrigin` stops at `_maxOffsetForSameLineSearch`, 3). The rule lives in one
place, `src/ties.ts`: `tieOriginOf` for validation and repair, and its inverse `tieChainOf` for
the chains `setNote` and `transposeSelection` carry along.

## Diagnostics

One convention, ruled at the WP-015 freeze: every diagnostic identifier is kebab-case, an
invariant violation keys its kind as `rule` (`Violation`), and a warning or an error keys it as
`code` (`ParseWarning`, `PlaybackWarning`, `CommandWarning`, `CommandError`,
`NativeFormatError`). Model enum values (`slight`, `doubleFlat`, `belowOpenString`) stay
camelCase: they are data a file carries, not something reported about it.

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
  `NativeFormatError` whose `code` says what kind (`invalid-utf8`, `invalid-json`, `wrong-format`,
  `invalid-version`, `newer-version`, `migration-failed`, `invalid-document`) and whose `path` (and
  message prefix, `score.tracks[0].bars[2].id: ...`) names the offending field.
- **Warnings, never failures**, for what the schema cannot see: unknown fields anywhere in the
  document are dropped and reported (`code: 'unknown-field'`), and the score's invariant
  violations (`validateScore`) are reported with their rule as the `code`. Every `ParseWarning` path starts
  at the document root, so a score violation's path begins with `score`.
- **Migrations**: `MIGRATIONS[n]` turns a version-`n - 1` `score` into its version-`n` shape,
  working on plain JSON. Version 1's entry is the identity. A step that throws surfaces as a
  `NativeFormatError` naming both versions. Raising the version means: bump `SCORE_VERSION`,
  add the step, and add a fixture of the old version to the tests.
- **Test fixtures** live in `@reprise/model/testing` ("Test builders" below); `fullScore()` is
  the score that sets every node type and optional field, which the round-trip tests use.

## Modelling decisions

Where the architecture sketch (`docs/specs/architecture.md`, "Score model") left a loose end:

- **One version field**: the `.reprise` envelope's `version` is the only schema version and
  the migrations key; `Score` carries none, so an in-memory score never claims a version it
  was not migrated to. `SCORE_VERSION` is the envelope's current version.
- **IDs**: `newId()` is 12 base62 characters from `crypto.getRandomValues`, with rejection
  sampling so every character is equally likely. The bytes come from a 1 KiB pool refilled when
  spent: one `getRandomValues` call per id was about 60% of importing a 38,400-note file (#62),
  and pooling makes 100k ids about eight times faster. On `Score`, `MasterBar`, `Track`, `Bar`,
  `Voice`, `Beat` and `Note`. `IdSchema` enforces the format. A grace beat has no id of its
  own; its notes do.
- **Optional fields are exact** (`z.exactOptional()`): with `exactOptionalPropertyTypes` the
  inferred type is `field?: T`, never `T | undefined`, and the schema rejects an explicit
  `undefined`. Absent always means "not set", which keeps JSON and Immer patches unambiguous.
- **String numbering**: `Note.string` 1 is the highest-pitched string, as in Guitar Pro;
  `Track.tuning` is low to high, so a string's open pitch is `tuning[tuning.length - string]`.
- **`Note.fret` on drum and pitched tracks is the MIDI note**, and `Note.string` is required
  and `0` there. Required-and-zero keeps fretted code paths free of `undefined` checks; the
  `string-range` rule enforces 1 to the string count on fretted tracks and 0 elsewhere, and
  `fret-range` keeps a fretted note between 0 and `Track.fretCount`.
- **Spelling follows Guitar Pro**: a note outside the key is spelled with a sharp in C major
  and the sharp keys and with a flat in the flat keys, the natural letter first, plus a minor
  key's raised sixth and seventh (see "Pitch, tuning and spelling"). The alternative, the
  nearest spelling on the line of fifths (MuseScore's rule, which gives Eb, Ab and Bb in C
  major), was considered and set aside: tab players read Guitar Pro's sharps, and `respell`
  covers the exceptions one note at a time.
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
  mid-bar changes. The first master bar must carry one (`first-bar-tempo`): `insertBar` at 0
  moves the mark onto the new first bar, and `removeBar` moves a removed bar's mark onto the bar
  after it when that has none, whichever bar it was.
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
- **`Track.display.octaveShift`** (new) is written minus sounding pitch, in octaves: `1` on
  fretted tracks, since guitar and bass are written an octave above where they sound, `0` on
  drum and pitched tracks. `createTrack` sets it; readers map the file's staff transposition
  onto it; `staffPosition` takes it so layout places the written pitch.
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

## Commands and history

Every edit is a named `Command` whose `run(draft, warn)` mutates an Immer draft (ADR-0011).
`applyCommand(score, command)` returns the new score, a `Change` (the command name, forward and
inverse patches, and `touchedBars`) and the command's `warnings`. `createHistory()` wraps it
with undo and redo, which replay the patches, so a step costs what it changed: a thousand
single-note edits on an 8-track, 300-bar score hold 194 KB of patches against a 9.8 MB score
(`history-memory.test.ts`, budget 256 KiB).

```ts
import { createHistory, insertBar, setNote } from '@reprise/model';

const history = createHistory();
history.beginGroup('Paste bars'); // one undo step; nested groups flatten into the outer one
let { score } = history.apply(current, insertBar({ index: 4 }));
({ score } = history.apply(score, setNote({ beatId }, { string: 1, fret: 5 })));
history.endGroup();
const undone = history.undo(); // { score, change } with the patches it replayed
```

- `apply` takes the score the history last returned; a different document needs a new history.
  A command that changed nothing records no step and returns the score it was given. `undo` and
  `redo` refuse while a group is open, and a command refused inside a group leaves the group
  open, so end it in a `finally`.
- **Immer freezes** the result of every apply, and the input along with it, since the two share
  every untouched node. Build a score before handing it to a history and never mutate it after;
  edits go through commands.
- **Patches** are Immer's, with one rewrite: a splice is recorded as one `add` or `remove`
  rather than a `replace` of every element after it, so a bar inserted at the front of a long
  score costs a patch per track, not one per bar, and undo copies only what it restores.
- **`touchedBars`** are master-bar ids, the bar columns layout re-flows; the rule is in the
  header of `src/history.ts`. In short: a patch under `tracks/t/bars/b` or `masterBars/m` touches
  that column; a track property other than `channel`, `sound`, `program`, `bank` and the raw
  `lyrics` touches every column, as does any change to a whole track or array; `meta` touches
  none. Ids come from the scores before and after the edit, so a removed bar is listed with the
  bar that took its place; bars that only shifted are not, since layout re-breaks systems from
  the first listed bar onward.
- **Addressing** is by id: beats, notes, voices, master bars and tracks. Commands that create a
  node take an optional `id` so the caller can select it afterwards. Grace notes are reached
  through their beat (`setBeatEffect`, or a `beatIds` selection), not by note id.
- **Optional fields** are removed with `null` in the `Changes<T>` objects that `setNoteEffect`,
  `setBeatEffect`, `setBeatDuration`, `setMasterBar` and `setTrackProperties` take.
- **Warnings**: `Command.run(draft, warn)` may report what an applied edit changed beyond what it
  was asked, and `Applied.warnings` carries them as `{ code, noteId, message }`. Today only
  `transposeSelection` warns, with `transpose`'s `trill-dropped` and `natural-harmonic-moved`.
  `undo` and `redo` replay patches and report none.
- **Refusal**: a command throws `CommandError` (`code`, `command`, and `violations` for
  `invariant`) instead of producing a score that breaks the schema or adds a `validateScore`
  violation. Nodes an edit creates (a new beat's notes, grace notes) are checked in full, string
  range and fret ceiling included; for the nodes that already existed the checks count violations
  per rule before and after, so a violation an imported file already carried does not block
  unrelated edits. A fret count or tuning change that would leave more notes outside the
  neck or the string count than before is refused the same way.
- **Repair**: a tie whose origin an edit removes (a note, a beat, a bar, a string shift), moves
  to another pitch, interrupts with a note on its string or puts more than three bars back is
  released rather than refused. Removing an origin can also hand the tie an earlier one on the
  same fret, which keeps it: a removed middle link re-links a chain to its first note.
  `releaseTies` scans from the edit to the end of the bar `TIE_REACH_BARS` later, the furthest a
  tie reaching back into the edit can sit.
- **Tie chains share their pitch** (`tie-pitch`), as in Guitar Pro. Pitch flows forward: a new fret
  on a note (`setNote`, `transposeSelection`) carries along every note tied to it, and a tied
  note given a pitch of its own is released from its origin. `setNote` with an explicit
  `tie: true` and another fret than the origin's is refused as `tie-target`.

| Command                                | Notes                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setNote`                              | Merges the given fields over the note on the same string (same MIDI value off fretted tracks) or adds one; a rest becomes a played beat; frets follow ties.   |
| `removeNote`                           | A beat left without notes becomes a rest.                                                                                                                     |
| `setNoteEffect`                        | Any note field but id, string and fret.                                                                                                                       |
| `transposeSelection`                   | Each note through `transpose`, on its string; tie chains follow; refuses notes off the neck; drum and dead notes stay; warns.                                 |
| `shiftStrings`                         | Moves notes to the neighbouring string at the same pitch; refuses occupied strings and frets off the neck.                                                    |
| `insertBeat`, `removeBeat`             | A quarter rest by default; refuses to overfill the voice or to place a note off the neck.                                                                     |
| `setBeatDuration`, `setBeatRest`       | Duration, dots, tuplet; rest drops the notes.                                                                                                                 |
| `setBeatEffect`                        | Beat effects, plus text, chord, lyrics, mixer change and grace notes.                                                                                         |
| `insertBar`, `removeBar`               | All tracks at once; copy the previous signatures (the next bar's at index 0) and the next bar's voltas, shift `Track.lyrics`; a removed bar's tempo moves on. |
| `setMasterBar`                         | Time, key, tempo, repeats, alternate endings, jumps, targets, section, anacrusis, triplet feel, double bar.                                                   |
| `setTrackProperties`                   | Everything but id, kind and bars; `channel` and `display` merge; refuses a fret count that strands notes.                                                     |
| `addTrack`, `removeTrack`, `moveTrack` | A new track gets one empty bar per master bar; a score keeps at least one track.                                                                              |

Guitar Pro numbers frets up to the neck length whatever the capo, so the ceiling every command
places a note under is `fretCount`, the bound `transpose` and the `fret-range` rule share.
`transposeSelection` computes every note through `transpose`, so the two cannot disagree: a
stored accidental survives an octave move, and a trill whose alternate fret falls off is dropped
with a warning rather than refusing the edit. It keeps stay-on-string semantics and does not
re-finger; `transpose`'s `alternatives` are for an editor that wants to.

`insertBar` takes the volta numbers of the bar it is inserted before, so inserting before a volta
bar lengthens that ending (a user extending ending 2) rather than splitting the run; inserting
after the last volta bar, before an ordinary one, adds an ordinary bar.

## Pitch, tuning and spelling

Pure helpers over the model, with no state of their own.

- **Arguments are track-first** wherever a track is needed: `midiNote(track, note)`,
  `transpose(track, note, semitones)`, `spellNote(track, note, key)`, `respell(track, note, key)`.
- **`midiNote(track, note)`** is the sounding MIDI note: `tuning[tuning.length - string] +
capo + fret` on fretted tracks, so frets count from the capo as Guitar Pro writes them;
  `note.fret` as stored on drum and pitched tracks, even when a pitched track keeps a GP5
  tuning. A fretted note on a string the track lacks throws a `RangeError`.
- **`transpose(track, note, semitones)`** moves the note on its own string and returns
  `{ ok: true, note, warnings }` or `{ ok: false, reason, midi, alternatives }`, never throwing
  for a note that falls off. `reason` is `belowOpenString`, `aboveLastFret` (past `fretCount`,
  the fret numbers a Guitar Pro file holds whatever the capo) or `outOfMidiRange` (pitched
  tracks, 0 to 127). `alternatives` lists the other strings that can play the pitch, for a
  caller that knows which strings in the beat are free. A stored `accidental` survives only
  octave shifts; drum notes come back unchanged. `warnings` holds `trill-dropped` when the
  trill's alternate fret, which moves with the note, falls off and the trill is removed, and
  `natural-harmonic-moved` when the moved note carries a natural harmonic: its `value` is a node
  on the string and is left for the editor to re-derive, while an artificial harmonic's `value`
  is an offset and travels with the note.
- **`STANDARD_TUNINGS`** names fourteen tunings (guitar, 7-string, 4- and 5-string bass,
  ukulele), each in `Track.tuning` order. The ukulele is re-entrant, so its array is in string
  order, not pitch order. **`findTuningName(tuning)`** matches exactly, string count included.
- **`spell(midi, key, accidental?)`** returns `{ letter, octave, alter, accidental? }`.
  `octave` is scientific (C4 = 60) and belongs to the letter, so B#3 is MIDI 60. Preference:
  a stored accidental that can spell the pitch, then the key's own notes, then a minor key's
  raised seventh and sixth (F## and E# in G# minor), then the natural letter, then a sharp in
  sharp keys and C major or a flat in flat keys. The returned `accidental` is what to print against the
  key signature; cancelling an accidental earlier in the bar is the layout's job.
  `spellNote(track, note, key)` does the same from a note.
- **`Note.accidental` stores the alteration of the spelling** (`flat` = a lowered letter),
  not the printed sign. **`respell(track, note, key)`** flips C# and Db, E and Fb, B and Cb;
  D, G and A, which have no single-accidental alternative, cycle through their double sharp
  and double flat. It clears the stored accidental when the result is the key's default, so
  the note follows a later key change.
- **`staffPosition(spelling, clef, octaveShift = 0)`** is the line or space on a five-line
  staff: 0 the bottom line, 8 the top line, odd numbers spaces; below 0 and above 8 the even
  numbers are ledger lines. Treble, bass, alto and tenor clefs. `octaveShift` is the track's
  `display.octaveShift`, so a guitar's sounding E2 (MIDI 40) is placed as the written E3,
  position -7 on the treble staff rather than -14.
- **`percussionInstrument(midi)`** gives the GM (35 to 81) and GM2 (27 to 34, 82 to 87) drum
  name, default staff position (same numbering) and note head (`normal`, `cross`, `diamond`,
  `triangle`). Positions follow the common drum-kit layout (kick in the bottom space, a second
  kick on the bottom line, snare in the third space, hi-hats above the staff, toms descending);
  the hand-percussion rows (60 to 87) are placeholders for the drum-staff work package to
  revisit. Cymbals are crosses and bells diamonds; a
  mute and open pair (hi-hat, triangle, cuica, surdo) shares its position and differs by head
  or articulation, cross for mute.

## Timing and playback order

Pure helpers over the model, all from the root export.

```ts
import { expandPlaybackSequence, positionAtSeconds, secondsAtTick, tempoMap } from '@reprise/model';

const { sequence, warnings } = expandPlaybackSequence(score); // [{ masterBarIndex, passIndex }]
const map = tempoMap(score, sequence); // every pass with its start in seconds
positionAtSeconds(map, 12.5); // { sequenceIndex, passIndex, tick, playbackTick, beatIndex, ... }
secondsAtTick(map, 9600); // seconds at a playback tick, for the scheduler
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
- `barStartTicks(score)` is the same for every bar at once, a prefix sum with
  `masterBars.length + 1` entries whose last is the score's end, for layout passes that walk
  written order.

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
`undefined` for an empty voice. A position also carries `playbackTick`, the pass's `startTick`
plus `tick`, and `secondsAtTick(map, playbackTick)` is its inverse, so a scheduler can work in
one tick line across passes; it clamps like `positionAtSeconds`, and a tick on a pass boundary
belongs to the pass that starts there.

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

## Test builders (`@reprise/model/testing`)

The one subpath export, and the lint boundaries admit it only from test files
(`testing-entry-in-tests`). The builders import the package root, so they see exactly what other
packages see.

```ts
import { midi, note, score } from '@reprise/model/testing';

const s = score()
  .tempo(96)
  .timeSignature(3, 4)
  .track('guitar')
  .bar()
  .repeatStart()
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

- Master-bar calls (`tempo`, `timeSignature`, `key`, `repeatStart`, `repeatEnd`, `volta`,
  `section`, `jump`, `target`, `anacrusis`, `masterBar`) apply to the open bar's column; before any
  bar, `tempo`, `timeSignature` and `key` set the defaults. A new master bar copies the previous
  one's signatures. `bar()` before any track builds master-bar-only scores.
- `track('guitar' | 'bass' | 'drums' | 'piano', spec)` presets `createTrack`; `bass` is four
  strings E1 A1 D2 G2 on GM 33 with a bass clef.
- `build()` pads short tracks, adds a guitar when none was declared, gives the first bar the
  default tempo when it has no mark, and throws `ScoreBuildError` (with `violations`) when the
  schema or `validateScore` fails; `build({ validate: false })` skips the invariants. A builder
  makes one score. Ids are random by default, like a real score's; `build({ ids: 'sequential' })`
  numbers the nodes in document order (`mbar00000001`, `beat00000001`, ...) and keeps the ids a
  test gave, so a data snapshot keyed by node id, as layout's anchors are, does not change from
  run to run.
- `fullScore()` sets every node type and optional field. `largeScore(tracks, bars, { structure })`
  fills voice 1 with eighths of two notes and voice 2 with a whole-bar rest (8 by 300 is 38,400
  notes); `structure` adds tempo changes, repeats, 3/4 bars, rests and text. `beatOf` and
  `noteOf` find nodes by index.

## Not modelled yet

Readers drop these with a warning; each is a contract change if it is ever needed. Confirmed by
the lead for the phase-1 freeze and re-checked in WP-015.

- Song level: RSE settings, page setup, master volume and reverb, hidden tempo marks, MIDI
  ports and channels, gpif `WordsAndMusic` (read into `words` and `music`).
- Track level: the 12-string and banjo flags, tuning labels and flat display, partial capo,
  ottava lines and chromatic transposition (`display.octaveShift` covers the octave), multiple
  staves per track (collapsed onto one staff by
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

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
  It assumes schema-valid input.

| Rule                              | What it checks                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicate-id`                    | Every id is unique across the score.                                                                                                                     |
| `bar-count`                       | Every track has one bar per master bar.                                                                                                                  |
| `track-kind`                      | Fretted tracks have strings and frets; drum and pitched tracks have no tuning, capo or frets.                                                            |
| `voice-overfull`                  | A voice's beats sum to at most the bar length. Incomplete bars are allowed.                                                                              |
| `rest-with-notes`                 | A rest carries no notes.                                                                                                                                 |
| `string-range`                    | Fretted notes use strings 1 to the string count; drum and pitched notes use string 0.                                                                    |
| `duplicate-string`                | No two notes of a fretted beat share a string.                                                                                                           |
| `tie-target`                      | A tied note has a note on the same string (same MIDI note on drum and pitched tracks) in the previous beat of its voice, crossing into the previous bar. |
| `tuplet`                          | `n:of` is not 1:1 and lies strictly between 1:2 and 2:1.                                                                                                 |
| `dots`                            | 0 to 2 dots (defensive, for input that bypassed the schema).                                                                                             |
| `chord-diagram`                   | A complete diagram on a fretted track has one fret per string, fingering to match, barres in range.                                                      |
| `alternate-ending-order`          | Volta numbers on a bar are unique and ascending.                                                                                                         |
| `alternate-ending-outside-repeat` | Every run of consecutive volta bars contains a repeat end.                                                                                               |

## Modelling decisions

Where the architecture sketch (`docs/specs/architecture.md`, "Score model") left a loose end:

- **IDs**: `newId()` is 12 base62 characters from `crypto.getRandomValues`, with rejection
  sampling so every character is equally likely. On `Score`, `MasterBar`, `Track`, `Bar`,
  `Voice`, `Beat` and `Note`. `IdSchema` enforces the format.
- **Optional fields are exact** (`z.exactOptional()`): with `exactOptionalPropertyTypes` the
  inferred type is `field?: T`, never `T | undefined`, and the schema rejects an explicit
  `undefined`. Absent always means "not set", which keeps JSON and Immer patches unambiguous.
- **String numbering**: `Note.string` 1 is the highest-pitched string, as in Guitar Pro;
  `Track.tuning` is low to high, so a string's open pitch is `tuning[tuning.length - string]`.
- **`Note.fret` on drum and pitched tracks is the MIDI note**, and `Note.string` is required
  and `0` there. Required-and-zero keeps fretted code paths free of `undefined` checks; the
  `string-range` rule enforces 1 to the string count on fretted tracks and 0 elsewhere.
- **Durations**: `duration` is 1, 2, 4, 8, 16, 32 or 64 (the denominator), `dots` 0 to 2,
  `tuplet` `{ n, of }`. Tuplets can make tick lengths fractional (septuplets at 960 PPQ);
  the internal tick helper compares with a float tolerance, and WP-011 owns rounding.
- **Voices**: exactly four per bar, all present (a Zod tuple); unused voices have no beats.
- **Empty score**: one fretted track in E standard, 4/4, 120 BPM on the first master bar, and
  one bar whose four voices have no beats. A score has at least one track and one master bar.
- **Repeats**: `repeat.endCount` is the total number of plays of the section (2 = play twice),
  0 = no repeat end. Readers convert from formats that store "extra repeats".
- **Jumps and targets are split**: `MasterBar.jump?: { kind }` is the instruction read at the
  end of the bar (`daCapo`, `dcAlCoda`, `dcAlDoubleCoda`, `dcAlFine`, `dalSegno`, `dsAlCoda`,
  `dsAlDoubleCoda`, `dsAlFine`, `dalSegnoSegno`, `dssAlCoda`, `dssAlDoubleCoda`, `dssAlFine`,
  `toCoda`, `toDoubleCoda`); `MasterBar.targets` lists the places a jump lands on (`segno`,
  `segnoSegno`, `coda`, `doubleCoda`, `fine`). This is how GP5 and gpif store directions, and
  one bar can carry a target and a jump at once.
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
- **Mixer changes** (`Beat.mix`): `volume`, `pan`, `chorus`, `reverb`, `phaser`, `tremolo` are
  each `{ value, duration?, allTracks? }`, `tempo` is `{ value, duration?, label? }`, plus an
  optional `program` change. `duration` is the transition length in beats (absent = immediate).
  `allTracks` mirrors GP5's per-field "apply to all tracks" bit; tempo is global anyway.
- **Controller units**: channel settings and mixer values are MIDI controller units, 0 to 127,
  pan 64 = centre. Readers convert from Guitar Pro's 0 to 16 mixer scale (the step is about 8,
  so the conversion round-trips).
- **Drums** play on the GM percussion channel by virtue of `kind: 'drums'`; the model stores no
  MIDI channel. `program` selects the GM2 drum kit (0 standard). Display: standard notation,
  percussion clef. **Pitched** tracks default to standard notation, treble clef. Both have
  `tuning: []`, `capo: 0`, `fretCount: 0`.
- **`Track.fretCount`** (new) is the neck length, 24 by default, for transposition and the
  fretboard view.
- **Chords**: `Beat.chordDiagram` holds the name and the grid: `baseFret`, one absolute fret per
  string (string 1 first, `null` = muted, 0 = open), optional `barres` and per-string
  `fingering`, and `complete`, false when the file carries only a name. The sketch's separate
  `chordName` is dropped, since the diagram's `name` covers it.
- **Lyrics**: `Beat.lyrics` is one syllable per lyric line, index = line, up to five lines as
  in Guitar Pro; `''` where a line has nothing on this beat.
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

## Not modelled yet

Readers drop these with a warning; each is a contract change if it is ever needed: RSE
settings, page setup, master volume and reverb, GP5 beam grouping, fermatas, anacrusis, hidden
tempo, track mute and solo, MIDI ports and channels, the chord wizard's construction data
(root, type, extensions), note duration percentage, tenuto and staccatissimo, ottava and
transposing instruments, rasgueado and wah, and a second jump on one bar.

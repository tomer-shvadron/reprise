# @reprise/formats

File import and export for Reprise: Guitar Pro files in, `.reprise` and `.gp` out. The frozen
contract (`detect`, `read`, `write`, `Warning`) is in
[`docs/specs/architecture.md`](../../docs/specs/architecture.md), "Contracts"; the formats
themselves are described in [`docs/reference/file-formats.md`](../../docs/reference/file-formats.md),
and the reader conventions every format follows are in
[`docs/reference/score-model.md`](../../docs/reference/score-model.md), "Reading and writing
Guitar Pro files". The package imports `@reprise/model` and nothing else, and runs anywhere: no
DOM, no Node APIs.

| Format          | Reader              | Work package |
| --------------- | ------------------- | ------------ |
| gp3, gp4, gp5   | `readGp3To5` (here) | WP-040       |
| gp (GP7 and 8)  | not yet             | WP-042       |
| gpx (GP6)       | not yet             | WP-043       |
| `detect`/`read` | not yet             | WP-045       |

```ts
import { GpVersionError, readGp3To5 } from '@reprise/formats';

const { score, warnings, format, version } = readGp3To5(bytes); // format 'gp5', version 510
```

`readGp3To5` is synchronous and never throws on a damaged file: a file cut short yields the
score read up to the cut, with a `truncated-file` warning; a count no real file holds (a negative
beat count, 3,000 tracks) stops reading the same way with `corrupt-file`. The one error it throws
is `GpVersionError` (`code: 'unknown-version'`), whose message and `version` field carry the
header text, when the bytes do not start with a version it knows. Every score it returns passes
`ScoreSchema`; the fuzz test holds it to that.

## What the gp3, gp4 and gp5 reader covers

Everything in the file is read, in file order, with version-gated sections:

- **Header**: version, title, subtitle, artist, album, words, music (GP5; GP3 and GP4 have one
  author field, read into both), copyright, tab, instructions, notices.
- **Song**: global triplet feel (GP3, GP4), lyrics (GP4+), RSE master effect (GP5.10, skipped),
  page setup (GP5, skipped), tempo and its name (GP5), song key and octave, the 64 MIDI channels,
  directions and master reverb (GP5).
- **Master bars**: time and key signatures, repeat start and end, alternate endings, markers
  (as `section`, with colour), triplet feel (GP5), double bars, beam grouping (GP5, skipped).
- **Tracks**: name, colour, strings and tuning, fret count, capo, MIDI channel (program, volume,
  pan, chorus, reverb, phaser, tremolo), mute, solo, port, GP5's staff display flags and bank,
  and the RSE settings (skipped).
- **Bars**: one voice in GP3 and GP4, two in GP5, into the model's voices 1 and 2.
- **Beats**: duration, dot, tuplet, rest or empty beat, text, chord (name, diagram with barres
  and fingering), beat effects (vibrato, fade in, tap, slap, pop, tremolo bar, brush stroke, pick
  stroke, rasgueado), mixer changes (program, the six controllers with transition and
  all-tracks bits, tempo with name and transition), GP5's beam, stem and ottava flags.
- **Notes**: heavy and normal accents, ghost, tie, dead, dynamics, fret, both hands' fingering,
  duration percentage, GP5's swapped accidentals, and the effects: bend with every point, grace
  note, tremolo picking, slide (GP5's in-and-out mask), every harmonic kind, trill, let ring,
  hammer-on, vibrato, palm mute, staccato.

## Mapping decisions

The rules shared with every reader are in the score-model reference; these are the gp3-to-5
specifics and the places the file is ambiguous.

- **Track kind**: drums when the percussion flag is set or the track plays on MIDI channel 10;
  otherwise pitched when the program is outside the fretted families (GM 24 to 39, 104 to 107),
  keeping the tuning, capo and fret count; otherwise fretted. The reference states the keyboard
  rule for GP5; GP3 and GP4 store keyboards on strings the same way, so the rule applies to all
  three. Pitched notes become `open string + capo + fret`; drum notes keep the fret byte, which is
  the GM percussion note.
- **Strings**: the file lists string 1 (highest) first and the beat's string mask uses bit 6 for
  string 1; `Track.tuning` is reversed to lowest first. A mask bit for a string the track lacks
  carries no note block (every reader of the format skips it unread) and is reported as
  `note-off-string`.
- **Clef**: bass when the lowest string is below B1 or GP5's clef setting says so, as Guitar Pro
  draws it; treble otherwise; percussion on drums.
- **Repeats**: `endCount` is the GP5 byte, or the GP3/GP4 byte plus one (they store the extra
  plays).
- **Alternate endings**: GP5 stores a bit mask on the bracket's first bar; GP3 and GP4 store a
  count from which the bar takes every number not yet used since the repeat start. Numbers are
  then copied onto every bar of the bracket through the bar that closes the repeat; a final
  bracket with no repeat end ahead stays one bar.
- **Ties**: Guitar Pro often stores 0 as a tied note's fret, so a tie takes the fret of the note it
  continues: the last note on its string in the voice, searched back through up to three bars as
  Guitar Pro ties it. The model ties only to the previous beat, so an origin further back lends
  its fret and the tie is released (`tie-beyond-previous-beat`); a tie with no origin at all is
  released too (`tie-without-origin`). Either way the score stays valid.
- **Hammer-ons and pull-offs**: the flag moves from the origin to the next note on the same
  string in the same voice, across bar lines, up to a rest and within three bars; with none,
  `hammer-pull-without-destination`.
- **Grace notes**: one `Beat.grace` entry per grace note, on the main note's string; `before`
  is false for GP5's on-beat graces. The duration byte's 1, 2 and 3 are read as a sixty-fourth,
  thirty-second and sixteenth. The transition becomes a `legato` slide on the grace note, a bend
  up to the main note's pitch on it, or `hammerPull` on the main note. A fret of -1 (GP3 and GP4's
  dead grace note) and GP5's dead flag both give `dead`.
- **Tuplets**: 3:2; 5, 6 and 7 in the time of 4; 9 to 13 in the time of 8; the compound-time
  duplet, quadruplet and octuplet as 2:3, 4:3 and 8:6.
- **Strokes**: `effects.brush`, the speed byte 1 to 6 as the stroke dialog's six durations, a
  128th (1) down to a quarter (6). GP3 and GP4 write the down stroke first, GP5 the up stroke.
- **Vibrato**: beat-effect bit 0x02 is Guitar Pro's beat-level "wide vibrato", read as
  `effects.vibrato: 'wide'`. Bit 0x01 is a note's `slight` vibrato: GP3 has no note-level flag and
  stores it only here, so it goes onto the beat's notes; GP4 and GP5 set it alongside the note's
  own flag (0x40 in the second note-effect byte), which already carries it.
- **Chord diagrams**: the GP3 new format stores up to two barres as ints, GP4 and GP5 up to
  five as bytes; both are read, as is GP4/GP5 fingering.
- **GP3 tremolo bar**: a single depth, positive downwards, read as a `dip` to that depth at
  mid-note, the shape GP4 writes for the same effect.
- **Harmonics**: `value` is the fret position the harmonic sounds at, from the node's distance
  above the fretted note (2.4, 3.2, 8.2, 9.6, 14.7 and 21.7 where the node falls between frets);
  GP5's artificial harmonic is computed from its stored pitch, GP4's from its type (15, 17, 22 are
  +5, +7, +12); pinch and semi harmonics sound the octave.
- **Swapped accidentals** (GP5): the note is respelled with the model's `respell` against the
  bar's key, which stores the enharmonic in `Note.accidental`.
- **Lyrics**: the raw block goes to the lyric track's `Track.lyrics` (all five lines, `startBar`
  0-based) when any line has text; `Beat.lyrics` gets one syllable per played beat of voice 1
  from each line's start bar, skipping rests and empty beats. Syllables end at a space, a line
  break or after a hyphen; each extra space leaves a beat without one; `+` joins words; `[...]` is
  a comment; trailing `_` is dropped.
- **Mixer scale**: channel and mixer values are 0 to 16 in the file and `value × 8` (capped at 127) in the model; out-of-range values are clamped with `invalid-value`.
- **Text**: windows-1252, which Guitar Pro 3 to 5 used on nearly every system; the file does not
  say which code page wrote it.
- After reading, `validateScore` runs and each violation becomes a warning with its rule as the
  `code` and its `path` in the location. The fixtures carry real ones: `effects.*` and `notes.*`
  overfill some bars on purpose.

## Version differences

| Section                   | GP3                                    | GP4                                                 | GP5.00                     | GP5.10                      |
| ------------------------- | -------------------------------------- | --------------------------------------------------- | -------------------------- | --------------------------- |
| Header fields             | 8 + notices                            | 8 + notices                                         | 9 (music) + notices        | same                        |
| Triplet feel              | song bool                              | song bool                                           | per master bar             | same                        |
| Lyrics                    | none                                   | block before tempo                                  | same                       | same                        |
| RSE master effect         | none                                   | none                                                | none                       | 19 bytes                    |
| Page setup, tempo name    | none                                   | none                                                | yes                        | yes                         |
| Hide tempo                | none                                   | none                                                | none                       | bool after tempo and in mix |
| Octave after key          | none                                   | byte                                                | byte                       | byte                        |
| Directions, master reverb | none                                   | none                                                | 19 shorts + int            | same                        |
| Repeat end byte           | extra plays                            | extra plays                                         | total plays                | same                        |
| Alternate endings         | count, flagged                         | count, flagged                                      | mask, always present       | same                        |
| Master bar tail           | none                                   | none                                                | beams, triplet feel, pad   | same                        |
| Track tail                | none                                   | none                                                | staff flags, bank, RSE     | + 4 bytes, 2 strings        |
| Voices per bar            | 1                                      | 1                                                   | 2, after a line-break byte | same                        |
| Chord, new format         | 25 + name(34) + 6 frets + 2 int barres | 16 + name(21) + 7 frets + 5 byte barres + fingering | same as GP4, always new    | same                        |
| Beat effects              | 1 flags byte                           | 2 flags bytes                                       | 2, strokes up then down    | same                        |
| Tremolo bar               | type 0 + one int depth                 | point list                                          | same                       | same                        |
| Mix table                 | no all-tracks byte                     | all-tracks byte                                     | + RSE, tempo name, wah     | + hide tempo, effect names  |
| Beat tail                 | none                                   | none                                                | display flags short        | same                        |
| Note duration             | 2 bytes                                | 2 bytes                                             | big-endian double          | same                        |
| Note tail                 | none                                   | none                                                | flags byte (accidentals)   | same                        |
| Note effects              | 1 flags byte, slide bit                | 2 flags bytes, slide byte                           | 2, slide mask              | same                        |
| Grace note                | 4 bytes                                | 4 bytes                                             | + flags (dead, on beat)    | same                        |
| Harmonic                  | beat level, 2 kinds                    | type byte                                           | type + data for 2 and 3    | same                        |

## Warnings

`Warning` is `{ code, severity, message, location, count? }`. `location` holds the byte
`offset` where the construct starts and the 0-based `track`, `bar`, `voice` and `beat` it ended
up in, or the `path` of an invariant violation. `info` warnings are folded by code: one entry,
the first location, and `count`.

| Code                              | Severity | Meaning                                                                                                                                                        |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `truncated-file`                  | error    | The file ends inside a structure; the score stops at the last complete beat.                                                                                   |
| `corrupt-file`                    | error    | A count no real file holds (negative, or past the reader's limits: 2048 bars, 127 tracks, 1000 notice lines, 512 beats, 240 bend points); reading stops there. |
| `invalid-value`                   | warning  | A value out of range (time signature, key, duration, fret, mixer value, tuning, …), replaced.                                                                  |
| `note-off-string`                 | warning  | A string-mask bit for a string the track does not have, skipped.                                                                                               |
| `tie-without-origin`              | warning  | A tied note with no earlier note on its string within three bars, released.                                                                                    |
| `tie-beyond-previous-beat`        | warning  | A tied note whose origin is more than one beat back; it takes the origin's fret and is released, since the model ties only to the previous beat.               |
| `hammer-pull-without-destination` | warning  | A hammer-on or pull-off with no following note on its string.                                                                                                  |
| `lyrics-unplaced`                 | warning  | Syllables past the lyric track's last played beat, or lyrics for a track the file lacks.                                                                       |
| `trailing-data`                   | info     | Non-zero bytes after the last bar (GP3's four zero bytes are not reported).                                                                                    |
| `rse-dropped`                     | info     | RSE master, track, instrument or effect settings.                                                                                                              |
| `page-setup-dropped`              | info     | GP5 page size, margins and header and footer templates.                                                                                                        |
| `hidden-tempo-dropped`            | info     | GP5.10's hidden tempo marks, which will show.                                                                                                                  |
| `song-key-dropped`                | info     | The song-level key and octave (bar key signatures are kept).                                                                                                   |
| `master-reverb-dropped`           | info     | GP5's master reverb.                                                                                                                                           |
| `midi-routing-dropped`            | info     | MIDI port and channel numbers; the channel's settings are kept on the track.                                                                                   |
| `track-flags-dropped`             | info     | 12-string, banjo, tuning display, hidden from the multitrack view, tablature off a fretted track.                                                              |
| `beam-grouping-dropped`           | info     | GP5's beam grouping per time signature.                                                                                                                        |
| `beat-display-dropped`            | info     | GP5's beam breaks, stem directions and bracket display.                                                                                                        |
| `ottava-dropped`                  | info     | GP5's ottava lines.                                                                                                                                            |
| `rasgueado-dropped`               | info     | A rasgueado.                                                                                                                                                   |
| `wah-dropped`                     | info     | A GP5 wah pedal position.                                                                                                                                      |
| `chord-construction-dropped`      | info     | The chord wizard's root, type, extensions and omissions (name and diagram are kept).                                                                           |
| `note-duration-dropped`           | info     | A note's time-independent duration or duration percentage.                                                                                                     |
| `bend-vibrato-dropped`            | info     | The vibrato byte on a bend point.                                                                                                                              |
| any `validateScore` rule          | warning  | The finished score breaks an invariant; `location.path` points at it.                                                                                          |

## Known gaps

- **Fixtures**: no gp3 file has more than one track, and lyrics, a second voice, tempo changes
  and keyboard tracks appear in no binary fixture. `test/hand-built.test.ts` covers those paths
  with files built byte by byte (`test/gp-file.ts`). alphaTab reads those files with the same
  notes, ties, tempo changes, lyrics and drum notes in all five versions, so their layout is the
  format's as far as those fields go; the fixtures prove the rest. There is no GP4.00 or GP5.00
  fixture: those layouts are read as alphaTab reads them and covered by the hand-built files only.
- **Text encoding** is always windows-1252.
- **Simile marks** do not exist in GP3 to GP5, so the reader has nothing to expand.
- **The oracle comparison** against alphaTab is WP-041. Differences seen while building and
  reviewing this reader, which that test's tolerance list will need: alphaTab's `isRest` is also
  true for Guitar Pro's empty beat (`rest || notes.length === 0` here); alphaTab moves a beat's
  tempo change onto `masterBar.tempoAutomations` where this reader keeps `Beat.mix.tempo`;
  alphaTab drops redundant bend points and recomputes bend and whammy kinds where this reader
  keeps the file's; alphaTab maps GP5 percussion notes 27, 28 and 32 to its own articulation
  indices; alphaTab reads beat vibrato as slight and ignores GP3's tremolo bar; alphaTab makes
  every grace note a thirty-second; alphaTab's stroke table is one step slower than Guitar Pro's
  (1 and 2 both a 128th, 6 an eighth); alphaTab leaves the compound-time duplet, quadruplet and
  octuplet without a denominator; alphaTab marks voltas on the bracket's first bar only; alphaTab
  keeps a lyric line's leading and trailing spaces as empty syllables.

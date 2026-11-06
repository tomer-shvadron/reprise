# @reprise/formats

File import and export for Reprise: Guitar Pro files in, `.reprise` and `.gp` out. The frozen
contract (`detect`, `read`, `write`, `Warning`) is in
[`docs/specs/architecture.md`](../../docs/specs/architecture.md), "Contracts"; the formats
themselves are described in [`docs/reference/file-formats.md`](../../docs/reference/file-formats.md),
and the reader conventions every format follows are in
[`docs/reference/score-model.md`](../../docs/reference/score-model.md), "Reading and writing
Guitar Pro files". The package imports `@reprise/model` and `fflate` (the gp zip, pinned) and nothing else, and
runs anywhere: no DOM, no Node APIs.

| Format                  | Reader              | Work package |
| ----------------------- | ------------------- | ------------ |
| gp3, gp4, gp5           | `readGp3To5` (here) | WP-040       |
| gp (GP7 and 8)          | `readGp` (here)     | WP-042       |
| gpx (GP6)               | `readGpx` (here)    | WP-043       |
| `detect`/`read`/`write` | here                | WP-045       |

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

## Import and export (the Formats contract)

```ts
import { FormatError, detect, formatOfExtension, read, write } from '@reprise/formats';

const { score, warnings } = await read(file.bytes); // the bytes decide the format
detect(file.bytes); // 'gp5', or undefined; reads the signature only

// The extension is a fallback only, for bytes that match no signature.
try {
  await read(file.bytes);
} catch (error) {
  if (error instanceof FormatError && error.code === 'unknown-format') {
    const claimed = formatOfExtension(file.name);
    if (claimed) await read(file.bytes, claimed);
  }
}

const { bytes, dropped } = await write(score, 'reprise', { app: { name: 'reprise', version } });
```

`read` and `write` return promises and never throw synchronously, so a worker can take them over
behind the same signatures; today they run on the caller's thread. `read` resolves to exactly
`{ score, warnings }`: the readers' `format`, `version` and the native file's `app` are not
passed on, and a caller that wants the format calls `detect`. `write`'s third argument is the
`app` stamped into a `.reprise` file, `{ name: 'reprise', version: '0.0.0' }` by default.

**Detection** reads the signature only, first match wins:

| Format        | Signature                                                                                        | Offset                    |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| gp3, gp4, gp5 | `0x18`, `FICHIER GUITAR PRO `, one letter (`v`, or `L` in some exports), then `3.`, `4.` or `5.` | bytes 0 to 22             |
| gp            | `PK\x03\x04`, a zip local file header                                                            | 0                         |
| gpx           | `BCFZ` or `BCFS`                                                                                 | 0                         |
| reprise       | `{` after an optional UTF-8 BOM and ASCII whitespace                                             | first non-whitespace byte |

The binary family is told apart by its major digit only, so `v5.20` detects as gp5 and the reader
then names the header (`unknown-version`). The same table is in
[`docs/reference/file-formats.md`](../../docs/reference/file-formats.md), "Detection".

**The `format` argument** picks the reader and is not checked against the signature first. gp3,
gp4 and gp5 share one reader whose header decides the version, so `read(gp4Bytes, 'gp5')` reads
without complaint. When the chosen reader says the bytes are not its format at all
(`unknown-version`, `invalid-zip`, `not-bcfz`, `invalid-utf8`, `invalid-json`, `wrong-format`),
the bytes are sniffed, and if they belong to another reader the error becomes `format-mismatch`
with `format` (what was asked) and `detected` (what the bytes are).

**Size limit.** `MAX_FILE_BYTES` is 256 MiB, the cap the gp and gpx readers already put on a
declared inflated size; the largest real file known is about 1.5 MB, and a file at the limit could
not be shown within the 400 MB renderer budget anyway. `too-large` has three sources: the file
itself (checked before anything is read, no `cause`), a gp zip entry declaring more (`GpError`),
and a gpx header declaring more (`GpxError`).

**Errors.** Every failure is a `FormatError` with a kebab-case `code`, the `format` whose reader or
writer failed, and the reader's own error as `cause` (so `GpifError.line`, `NativeFormatError.path`
and `GpVersionError.version` stay reachable). The message is the reader's. An error that is not a
reader's is a bug and is rethrown untouched.

| Code                                                                                                                       | From                             | Meaning                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `unknown-format`                                                                                                           | `read`                           | No format given and the bytes match no signature.                         |
| `format-mismatch`                                                                                                          | `read`                           | The given format's reader refused the bytes, which are `detected`.        |
| `too-large`                                                                                                                | `read`, `readGp`, `readGpx`      | Over `MAX_FILE_BYTES`, or a container declaring more.                     |
| `unsupported-format`                                                                                                       | `write`                          | `write(score, 'gp')` until the gp writer (WP-044) lands.                  |
| `unknown-version`                                                                                                          | `readGp3To5`                     | A header the binary reader does not know, or none.                        |
| `invalid-zip`, `missing-score`                                                                                             | `readGp`                         | Not a readable zip; no `Content/score.gpif`.                              |
| `not-bcfz`, `truncated`, `corrupt`, `missing-score`                                                                        | `readGpx`                        | See "gpx (GP6)" below.                                                    |
| `invalid-utf8`, `invalid-xml`, `not-gpif`, `empty-score`                                                                   | the gpif reader                  | A `score.gpif` that cannot become a score.                                |
| `invalid-utf8`, `invalid-json`, `wrong-format`, `invalid-version`, `newer-version`, `migration-failed`, `invalid-document` | `parseNative`, `serializeNative` | A `.reprise` file that cannot be read, or a score that cannot be written. |

**Warnings** come back in the one `Warning` shape below ("Warnings"). The binary reader's pass
through unchanged. A gpif warning keeps its code and message; its element path goes to
`location.element`, or, for a `validateScore` rule, its model path to `location.path` without the
leading `score`; `count` is set only when it is above 1. Its severity comes from an exhaustive
table, so a new gpif code fails to compile until it has one:

| Severity  | gpif codes                                                                                                                                                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`   | `voice-dropped`                                                                                                                                                                                                                                                                                           |
| `warning` | `unknown-element`, `unknown-value`, `invalid-value`, `missing-reference`, `multiple-staves`, `simile-expanded`, `grace-without-beat`, `grace-duration-clamped`, `grace-tie-released`, `hammer-pull-without-destination`, `tempo-moved`, `automation-dropped`, `default-tempo`, every `validateScore` rule |
| `info`    | `not-modelled`, `long-note-tied`, `drum-articulation`                                                                                                                                                                                                                                                     |

A native `unknown-field` or violation is a `warning`, at its document path less the leading
`score` (an envelope field keeps `['app', …]`). No fixture produces an `error` warning.

**Known gaps.**

- `write(score, 'gp')` rejects with `unsupported-format` until WP-044's writer is on main.
- Nothing runs off-thread yet.
- Any zip detects as gp and any JSON object as reprise; the reader tells them apart.
- `read` has no file name, so it reports no extension mismatch; a caller can compare `detect`
  with `formatOfExtension` itself.

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
  keeping the tuning, capo and fret count; otherwise fretted. This is the reference's rule for all
  three versions, which store keyboards on strings the same way. Pitched notes become
  `open string + capo + fret`; drum notes keep the fret byte, which is the GM percussion note.
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
  Guitar Pro ties it, which is the model's `tieOriginOf` reach. The tie is kept wherever an origin
  is found, so a note held under a melody on other strings stays one note across beats and bar
  lines; a tie with no origin is released (`tie-without-origin`). Either way the score stays
  valid.
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
up in, or the `path` of an invariant violation; through `read`, a gp or gpx warning carries the
gpif `element` instead. `info` warnings are folded by code: one entry,
the first location, and `count`.

| Code                              | Severity | Meaning                                                                                                                                                        |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `truncated-file`                  | error    | The file ends inside a structure; the score stops at the last complete beat.                                                                                   |
| `corrupt-file`                    | error    | A count no real file holds (negative, or past the reader's limits: 2048 bars, 127 tracks, 1000 notice lines, 512 beats, 240 bend points); reading stops there. |
| `invalid-value`                   | warning  | A value out of range (time signature, key, duration, fret, mixer value, tuning, …), replaced.                                                                  |
| `note-off-string`                 | warning  | A string-mask bit for a string the track does not have, skipped.                                                                                               |
| `tie-without-origin`              | warning  | A tied note with no earlier note on its string within three bars, released.                                                                                    |
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
- **The alphaTab oracle** covers gp3, gp4, gp5, gp and gpx; its known differences are the tolerance
  list under "Oracle" below.

## gp (GP7/8) and gpif

```ts
import { readGp, readGpif } from '@reprise/formats';

const { score, warnings } = readGp(bytes); // a .gp file
const fromXml = readGpif(xml, { partConfiguration }); // score.gpif from any container
```

- `src/gp/` is the Guitar Pro 7 and 8 container: a zip read with `fflate` (pinned, the package's one runtime dependency besides the model). Only `Content/score.gpif` and `Content/PartConfiguration` are inflated, and only when the central directory declares them under 256 MB, since fflate allocates the declared size up front; the stylesheets, layout and preferences are Guitar Pro's view state.
- `src/gpif/` is the XML model shared with Guitar Pro 6. `readGpif` takes the document as a string or UTF-8 bytes, plus the container's `PartConfiguration` bytes when it has them. The gpx container finds those two entries in its file system and calls it (see "gpx (GP6)" below).
- Reading runs in two passes: `read-document.ts` turns every section into id-keyed maps (`GpifDocument`), and `build-score.ts` resolves the references into a score through the model's factories and `newId()`, then runs `validateScore` and reports each violation as a warning.
- Both readers are synchronous; the async `read()` of the Formats contract wraps them ("Import and export" above).
- Errors: `GpError` (`invalid-zip`, `missing-score`, `too-large`) for the container, `GpifError` (`invalid-utf8`, `invalid-xml` with `line` and `column`, `not-gpif`, `empty-score`) for a document that cannot become a score. Everything else is a `GpifWarning`.

### Coverage

| gpif                                                                                                                                                                                                     | Model                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Score` title, subtitle, artist, album, words, music, copyright, tabber, instructions, notices                                                                                                           | `Score.meta`; `WordsAndMusic` fills `words` and `music` when they are empty; notices split by line                                         |
| `MasterTrack/Tracks`, `Anacrusis`                                                                                                                                                                        | track order; `anacrusis` on the first master bar                                                                                           |
| `MasterTrack/Automations` `Tempo`                                                                                                                                                                        | `MasterBar.tempo` at a bar start, `Beat.mix.tempo` mid-bar; unit 1 to 5 to `TempoMark.unit`; `Text` to `label`; linear ramps as `duration` |
| `Track` name, short name, colour, `PlaybackState`                                                                                                                                                        | `name`, `shortName`, `color`, `channel.mute` and `solo`                                                                                    |
| `Track/InstrumentSet` (`drumKit`), GP6 `GeneralMidi table="Percussion"`                                                                                                                                  | `kind: 'drums'`; articulations give each drum note its GM sound                                                                            |
| `Track/Sounds` first sound's MIDI program, MSB and LSB                                                                                                                                                   | `program`, `bank`; later `Sound` automations become `Beat.mix.program`                                                                     |
| `Track/RSE/ChannelStrip` parameters 12 and 11                                                                                                                                                            | `channel.volume`, `channel.pan` (0 to 1 scaled to 0 to 127)                                                                                |
| `Track/Transpose/Octave`                                                                                                                                                                                 | `display.octaveShift` (negated)                                                                                                            |
| `Track/Lyrics/Line` text and offset                                                                                                                                                                      | `Track.lyrics`; dispatched onto `Beat.lyrics` when no beat carries its own                                                                 |
| `Staff/Properties` `Tuning`, `CapoFret`, `FretCount`, `DiagramCollection`, `ChordCollection` (GP6 track `Properties` too)                                                                                | `tuning`, `capo`, `fretCount`, `Beat.chord` with its diagram                                                                               |
| `PartConfiguration` (container)                                                                                                                                                                          | `display.notation`, and the pitched-track rule below                                                                                       |
| `MasterBar` `Time`, `Key`, `Repeat`, `AlternateEndings`, `Directions`, `Section`, `TripletFeel`, `DoubleBar`                                                                                             | the master bar fields; voltas propagated over the bracket                                                                                  |
| `Bar` `Clef`, `Voices`, `SimileMark`                                                                                                                                                                     | `Bar.clef` (changes only), the four voices; simile bars expanded                                                                           |
| `Beat` `Rhythm`, `Notes`, `Dynamic`, `GraceNotes`, `FreeText`, `Chord`, `Lyrics`, `Fadding`, `Tremolo`, `Arpeggio`, `Whammy`                                                                             | duration, dots, tuplet, rest, note dynamics, `grace`, `text`, `chord`, `lyrics`, `effects`                                                 |
| `Beat/Properties` `Brush`, `PickStroke`, `Slapped`, `Popped`, `VibratoWTremBar`, `WhammyBar*`; `Beat/XProperties` `687935489`                                                                            | `effects.brush`, `pickStroke`, `slapping`, `popping`, `vibrato`, `whammy`; the brush or arpeggio `duration`                                |
| `Note/Properties` `String`, `Fret`, `Midi`, `Octave`/`Tone`, `ConcertPitch`, `Tapped`, `Muted`, `PalmMuted`, `HopoOrigin`, `HopoDestination`, `HarmonicType`, `HarmonicFret`, `Slide`, `Bended`, `Bend*` | `string`, `fret`, `accidental`, beat `tapping`, `dead`, `palmMute`, `hammerPull`, `harmonic`, `slide`, `bend`                              |
| `Note` `Tie`, `LetRing`, `AntiAccent`, `Accent`, `Vibrato`, `Trill`, `LeftFingering`, `RightFingering`, `InstrumentArticulation`                                                                         | `tie`, `letRing`, `ghost`, `staccato` and `accent`, `vibrato`, `trill`, fingers, drum sound                                                |
| `Rhythm` `NoteValue` (`Long` to `256th`), `AugmentationDot`, `PrimaryTuplet`                                                                                                                             | `duration`, `dots`, `tuplet`; double and quadruple wholes become tied whole notes                                                          |

**Track kind.** A drum kit is `drums`. Guitar Pro 7 gives every track a six-string tuning, a piano included, so the tuning cannot tell a keyboard from a guitar; a track whose program is outside the fretted GM families (24 to 39, 104 to 107) and whose part configuration shows no tablature is `pitched`, which is the rule the fixture manifest's oracle applies. Without part configuration bytes the program decides alone. A pitched track keeps the file's tuning and fret count, as the model allows, so a gp writer can finger it again; its notes take the `Midi` property.

### Fixtures

Every `fixtures/gp/*.gp` matches the manifest's track, bar and note counts, shows exactly the manifest's feature flags in the model, raises no `unknown-element` warning, and round-trips through `serializeNative`/`parseNative` unchanged. A throwaway comparison with alphaTab 1.8.4 also matched per bar and voice: every beat's duration, dots and tuplet and every note's string, fret and tie, the drum notes' GM sounds, the tempo automations and the track colours and volumes. The oracle test ("Oracle" below) now holds every gp fixture to the same comparison as the binary formats, with no tolerance needed.

The corpus is thin: none of the seven files has a bend, slide, harmonic, hammer-on, grace note, chord diagram, simile mark or second staff. Those paths are covered by hand-written gpif documents in `src/gpif/read-gpif.test.ts` (built with `src/gpif/test/gpif-builder.ts`), whose shapes follow alphaTab's reader and writer.

### gpif quirks

Each verified against alphaTab's `GpifParser` (and `GpifWriter` where noted) in `@coderline/alphatab@1.8.4`.

- **Shared nodes.** A voice may list one beat id several times (`multivoice-rhythm.gp` does: `6 7 8 9 9 7 8 9 9`), and beats share notes. Every reference becomes a fresh model node with its own id (alphaTab clones too: `BeatCloner.clone`, `NoteCloner.clone` in `_buildModel`).
- **String numbering.** `Note/Properties/String` is 0-based from the **lowest** string and `Tuning/Pitches` lists the lowest string first (`_parseNoteProperties`, `_parseStaffProperty`). The tuning is already in the model's order; the string becomes `strings - index`. The reference's "a reader reverses the tuning" is a GP3 to GP5 rule.
- **Repeat count** (`MasterBar/Repeat@count`) is already the total number of plays (`_parseMasterBar`), so `endCount` is the count as is.
- **Volta brackets** mark only their first bar. The reader copies the numbers onto each following bar up to and including the bar that closes the repeat; a bracket with no repeat end ahead (a final ending) stays one bar.
- **Lyric offsets** (`Lyrics/Line/Offset`) are 0-based bar indexes, unlike GP3 to GP5's 1-based ones (`_parseLyricsLine`; the writer writes `bar.index`).
- **Per-beat lyrics win.** When any beat carries `Lyrics`, the track's block is not laid onto beats (`_skipApplyLyrics`).
- **Tempo units.** `Value` is `"<bpm> <unit>"`, 1 to 5 for eighth to dotted half, scaled by 0.5, 1, 1.5, 2 and 3 to quarter-note BPM (`Automation.buildTempoAutomation`). A value without a unit is per quarter (alphaTab reads it as an eighth, `reference = 1`; Guitar Pro always writes a unit, so the quarter default is deliberate). `Position` is a 0 to 1 ratio of the bar.
- **Hammer-ons** are flagged at both ends (`HopoOrigin`, `HopoDestination`); the destination flag is the model's, and an origin whose destination is unflagged moves to the next note on its string in the voice within three bars, as far as alphaTab's `findHammerPullDestination` looks; off fretted tracks it is the next beat with notes, since a hammer-on changes pitch.
- **Bends** carry points but no type. Values are 100 per whole tone (/ 25 to quarter tones), offsets 0 to 100 (× 0.6); a missing origin offset is 0 and destination offset 100 (`_parseNoteProperties`). The kind is read off the curve, `custom` where none fits.
- **Accent** is a bit set: 1 staccato, 2 staccatissimo, 4 heavy accent, 8 accent, 16 tenuto (`_parseNote`). **AntiAccent** `Normal` is a ghost note; **Muted** is a dead note.
- **Slide flags**: 1 shift, 2 legato, 4 out down, 8 out up, 16 in from below, 32 in from above, 64 and 128 pick slides. The model keeps every set flag; alphaTab keeps one in and one out.
- **Trill** holds the alternate note as a MIDI value, not a fret (`trillValue` in alphaTab, whose `trillFret` subtracts the string's pitch; the GP5 importer adds it). On a fretted track the reader subtracts the open string and the capo, and drops the trill with `invalid-value` when that is not a fret; pitched tracks keep the MIDI value. The speed is not in the file; sixteenths, as alphaTab assumes.
- **Drum notes.** `InstrumentArticulation` indexes the track's `InstrumentSet` articulations in document order across elements; the articulation's `OutputMidiNumber` is the GM sound. The note's `Midi` property is the articulation's input number, which runs past GM's range (91 for a snare rim shot).
- **Diagrams** count strings from the lowest, store frets relative to a 0-based `baseFret` (`_parseDiagramItemForChord`), and name the ring finger `Rank` in the reader and `Ring` in alphaTab's writer; both are accepted. A finger on several strings at one fret is a barre. `DiagramCollection` wins over `ChordCollection` for the same id.
- **Channel strip.** Parameters 11 and 12 of `RSE/ChannelStrip` are pan and volume, 0 to 1 (`_parseChannelStripParameters`).
- **Stroke length.** A brush or arpeggio's spread is the beat `XProperty` with id `687935489`, an `Int` of MIDI ticks at 960 per quarter (`_parseBeatXProperties`, `beat.brushDuration`; the GP5 importer maps its stroke byte to the same 30 to 480 ticks). 960, 480, 240, 120, 60 and 30 become the model's `Stroke.duration` 4 to 128; any other count is reported and dropped. The other beat `XProperty` ids are beam direction and grouping, reported as `not-modelled`.
- **Simile marks** are on `Bar`, not `MasterBar` as `file-formats.md` has it (`_parseBar`).
- **Stem orientation.** `TransposedPitchStemOrientation` and `ConcertPitchStemOrientation` on every beat are directions Guitar Pro computed; only `UserTransposedPitchStemOrientation` is an override, so only it is reported.
- **Text oddities.** `Score/MultiVoice` holds `0>` in real files; the XML parser accepts `>` in text, as XML allows. `Fadding` is Guitar Pro's spelling.
- **GP6 forms** handled here for WP-043: track-level `Properties`, `GeneralMidi` with the percussion table, the `Whammy` element with attributes, `Instrument ref` ending in `-gs` for a second staff, and `Octave`/`Tone` note pitches. Read through `readGpif` alone, a GP6 drum note (no `InstrumentArticulation`) keeps its `Midi` number as the sound and one outside GM percussion (27 to 87) is reported with `invalid-value`; `readGpx` maps its `Element`/`Variation` to the GM sound first (see "gpx (GP6)").

### Known gaps

- **Multiple staves** collapse onto one (ADR-0006). Staff 1 keeps its voice indices as slots; every other staff's voice line that is used anywhere in the track takes the lowest slot staff 1 never uses, in staff and voice order, and keeps that slot in every bar, so ties, hammer-ons and grace notes follow it across bars. A line with no slot left is dropped, one `voice-dropped` per line counting its bars. The other staves' tunings and capos are not read.
- **Linear tempo ramps** become a ramp starting at the previous automation with `duration` rounded to whole quarter notes (`MixTransitionSchema` is an integer); a ramp that starts mid-bar starts from the tempo before it. No fixture has one.
- **Tempo automations between beats** move to the beat sounding at that moment (`tempo-moved`), as in `beat-tempo-change.gp` bar 2.
- **Drum articulation variants** (rim shot, choke, half-open) play as their GM sound and are reported once per track; the model has no articulation field.
- **Grace notes** longer than a 16th or shorter than a 64th are clamped; a grace beat's own effects are not kept.
- **Not read**: track and staff layout, RSE settings, MIDI routing, ottavas, chromatic transposition, partial capo, tuning labels and flat display, fermatas, free time, beam grouping, hairpins, legato slurs, timers, golpe, rasgueado, wah, dead slaps, slashed beats, barre marks, staccatissimo, tenuto, left-hand tapping, ornaments, pick slides, nested tuplets, sustain pedal, backing tracks, the chord wizard's data. Each is reported as `not-modelled`. A drum note's `Element` and `Variation` properties repeat what `InstrumentArticulation` says; they are read, and used only by the gpx container for GP6 notes without an articulation.
- A tempo automation with `Visible` false keeps its tempo; the hidden flag is reported.

### Warning catalogue

Every warning is `{ code, message, path, count }`: `path` is the gpif element (`Notes/Note[3]/Properties/Property[Slide]`), or the model path for an invariant (`score.tracks[0].bars[1].voices[1]`). Repeats of one loss on many nodes (an RSE pickup setting on every beat) fold into one warning with `count`, keeping the first path.

| Code                              | Raised when                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `not-modelled`                    | the file carries something the model has no field for (list above); it is dropped              |
| `unknown-element`                 | an element the reader does not know; it is ignored                                             |
| `unknown-value`                   | a known element with a value the reader does not know                                          |
| `invalid-value`                   | a value outside the model (a time signature, key, dot count, fret beyond 127, a volta past 8)  |
| `missing-reference`               | an id that names no node (bar, voice, beat, note, rhythm, chord, sound, track)                 |
| `multiple-staves`                 | a track with more than one staff, merged                                                       |
| `voice-dropped`                   | a further staff's voice line with no free slot, once per line with its bar count               |
| `simile-expanded`                 | a simile bar, filled with a copy of the bar it repeats                                         |
| `grace-without-beat`              | grace beats at the end of a voice with no beat after them                                      |
| `grace-duration-clamped`          | a grace note outside 16th to 64th                                                              |
| `grace-tie-released`              | a tied grace note; the model forbids `tie` on grace notes, so it is struck                     |
| `hammer-pull-without-destination` | a hammer-on origin with no later note on its string within three bars, once per track          |
| `tempo-moved`                     | a tempo change placed on the nearest earlier beat, or a ramp length rounded                    |
| `automation-dropped`              | a tempo or sound change in a bar with no beats, or past the last bar                           |
| `default-tempo`                   | no tempo at the start; 120 BPM is used                                                         |
| `long-note-tied`                  | a double whole or long note split into tied whole notes                                        |
| `drum-articulation`               | drum articulation variants mapped to their GM sound (once per track)                           |
| any `validateScore` rule          | the score breaks an invariant, as the file does (`multivoice-rhythm.gp` has an overfull voice) |

### XML parser decision

A dependency-free parser (`src/gpif/xml.ts`, about 200 lines) rather than `fast-xml-parser`. gpif uses a small part of XML: elements, attributes, text, CDATA, comments and the declaration, no namespaces, no mixed content that matters. Owning the parser keeps the package at one runtime dependency, gives syntax errors a line and column, and produces exactly the tree the reader walks (child order kept, CDATA verbatim).

Measured on an Apple M4 Pro, Node 24, after warm-up:

| Input                                                     | Size   | `parseXml` | Whole read                       |
| --------------------------------------------------------- | ------ | ---------- | -------------------------------- |
| `drum-tabs.gp`, the largest fixture                       | 145 KB | 0.53 ms    | 1.3 ms (`readGp`, unzip 0.15 ms) |
| Generated "long score", 8 tracks × 300 bars, 38,400 notes | 7.9 MB | 61 ms      | 188 ms (`readGpif`)              |

About 130 to 270 MB/s and linear in size, so the parser is not where import time goes; the long score's read leaves most of the 500 ms drop-to-first-paint budget to layout. The fixture timing is asserted in `test/read-gp.test.ts` with a loose bound for CI.

## gpx (GP6)

```ts
import { GpxError, readGpx } from '@reprise/formats';

const { score, warnings, format } = readGpx(bytes); // format 'gpx'
```

`src/gpx/` holds the Guitar Pro 6 container and the GP6 differences; the score itself goes through the gpif reader above, so everything in its coverage table, quirks and warning catalogue applies. Re-implemented from the format's description and from reading alphaTab's `GpxFileSystem` and TuxGuitar's decompressor, not copied.

**Container.**

- `bcfz.ts`: `BCFZ`, a little-endian 32-bit uncompressed length, then a bit stream read most significant bit first (`bit-reader.ts`). A 0 bit starts a literal run (a 2-bit count, then that many unaligned bytes); a 1 bit a back-reference (a 4-bit width w, then a w-bit distance and a w-bit length, both least significant bit first). A back-reference longer than its distance repeats the run, as LZ77 does; alphaTab and TuxGuitar cut it at the distance, which costs them a byte of the last sector's padding in three of the five fixtures. A declared length over 256 MB is refused before anything is allocated (`too-large`); the work is linear in input plus output.
- `bcfs.ts`: `BCFS`, then 4 KB sectors; sector 0 is a header. A file entry sector holds, little-endian, the type 2, a NUL-terminated name at 4, the size at 140, and from 148 the sector numbers of its blocks, ended by 0. A directory entry (type 1) has the same shape and its block lists its children's entry sectors, so the root's starts with `score.gpif`'s sector number, 2, the bytes of a file entry's type. Data blocks carry no marker, so every entry, file or directory, claims its blocks and the scan skips every sector already claimed. Names carry no paths in the files GP6 writes. Only `score.gpif` and `PartConfiguration` are copied out; a damaged file nobody asked for (the stylesheet of a cut-short file) does not fail the read.
- An uncompressed `BCFS` image is accepted too.
- **A stream may stop short.** Four fixtures inflate to exactly their declared length (`effects`, `key-signatures` and `repeat-close-alternate-endings` end on a back-reference one byte longer than its distance, in the last sector's zero padding, which readers that cut at the distance lose and then see as a short stream); `chords.gpx` stops one literal early. Running out of input is therefore not an error in the decompressor; a file entry whose blocks are missing is reported as `truncated` when the header declared those bytes, and `corrupt` when it points past them.

**GP6 differences**, handled in `gp6-differences.ts` and `gp6-drums.ts` through `readGpifWith`'s two hooks (`beforeRead` on the XML, `afterRead` on the read document), so the shared reader carries no version switch. The forms WP-042 already reads (track-level `Properties`, `GeneralMidi`, `Octave`/`Tone`, the `Whammy` element, `-gs` staves) are listed under "gpif quirks".

| GP6 form                                                                    | Handling                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drum note with `Element` and `Variation`, no `InstrumentArticulation`       | The GM sound of the kit piece and variant (17 pieces, 3 variants each, the sounds alphaTab 1.8.4's `PercussionMapper` assigns). A variant whose `Midi` input differs from its sound (rim shot 91 as snare 38) is `drum-articulation`, once per track; an unknown pair is `unknown-value`, once per track, and keeps its `Midi` number. Only on drum tracks, only without an articulation. |
| `Note/Accidental` (`Flat`, `Sharp`, `Natural`, `DoubleFlat`, `DoubleSharp`) | `Note.accidental`, unless a `ConcertPitch` property spells one; another word is `unknown-value`. alphaTab ignores it.                                                                                                                                                                                                                                                                     |
| `Beat/Bank`                                                                 | An RSE sound bank choice, `not-modelled` with the rest of RSE.                                                                                                                                                                                                                                                                                                                            |
| Track-level `Property[AutoBrush]`                                           | `not-modelled`, as GP7's `AutoBrush` track element.                                                                                                                                                                                                                                                                                                                                       |

**Fixtures.** Every `fixtures/gpx/*.gpx` matches the manifest's track, bar and note counts and feature flags, raises no `unknown-element` warning, is schema-valid and round-trips through `serializeNative`/`parseNative` unchanged (`test/gpx-fixtures.test.ts`). `effects`, `key-signatures` and `repeat-close-alternate-endings` exist as gp5 too, and both reads agree on every sounding beat's rhythm, every note's string, fret and tie, and the master bars' time, key, repeats and voltas; GP6 only padded short bars with rests when it resaved them. The oracle test ("Oracle" below) holds every gpx fixture to the full comparison; its one gpx tolerance is the grace duration, where alphaTab reports `effects.gpx`'s four 32nd grace notes as eighths and the file says `32nd`. No gpx fixture has a drum track, so the drum mapping is covered by hand-built documents in `test/gp6-differences.test.ts`; the container by hand-built BCFZ streams and BCFS images (`test/gpx-builder.ts`, `test/gpx-container.test.ts`).

**Timing** (Apple M4 Pro, Node 24, after warm-up): `effects.gpx` (28 KB, the largest) reads in 1.3 ms, 0.3 ms of it decompression; a synthetic 4 MB stream decompresses in 39 ms, about 100 MB/s. The fixture bound is asserted loosely for CI.

**Known gaps.**

- The GP6 drum sounds follow alphaTab, which plays the ride's third variant (the bell) as GM 59 (ride cymbal 2) rather than 53 (ride bell), and every cowbell as 56. Not checked against Guitar Pro 6 itself.
- `BinaryStylesheet`, `LayoutConfiguration` and `misc.xml` are not read (page and system layout, view state).
- `effects.gpx` holds three overfull voices (bars 4, 6 and 24) and a 5:2 rest tuplet (bar 29), which alphaTab reads the same way; they are reported as invariant warnings.

**Errors and warnings.** `GpxError` with `code`: `not-bcfz` (neither magic), `truncated` (the stream or the file system ends before data the header declared), `too-large` (a declared length over 256 MB), `corrupt` (a back-reference before the output's start or at distance zero, a block or size past the declared image, an image without `BCFS`), `missing-score` (no `score.gpif`). A `score.gpif` that cannot be read throws the gpif reader's `GpifError`. New warnings, all through the gpif catalogue's codes: `drum-articulation` and `unknown-value` for GP6 drum pairs, `unknown-value` for an unknown note accidental word, `not-modelled` for `Bank` and `AutoBrush`.

## Oracle

`test/oracle/` parses every fixture (gp3, gp4, gp5, gp and gpx) with
alphaTab (the dev-only oracle, `@coderline/alphatab` 1.8.4, through `ScoreLoader` with its
static `Logger` silenced: `Settings.core.logLevel` never reaches the loader) and with our
reader, reduces both to the same plain projection and diffs them. It runs in `pnpm test`; on its own,
`pnpm vitest run --project formats test/oracle`.

- **What is compared** (`projection.ts`): the score's title, subtitle, artist, album, words,
  music, copyright, tab, instructions and notices; per track the name, string count, tuning
  (MIDI, low to high), capo, percussion flag, program, bank, volume, pan, mute, solo, colour,
  octave shift and each bar's clef; per master bar the time signature, key, repeat start, repeat
  end count, alternate endings, every tempo set in the bar, the section and its letter, double
  bar, triplet feel, anacrusis and the directions; per beat, voice by voice, the duration, dots,
  tuplet, rest, grace notes (duration, before or on the beat, notes), text, chord name and grid
  (base fret, frets, barres), tremolo picking, beat vibrato, whammy (point count and the first,
  last, highest and lowest value), brush and arpeggio strokes, pick stroke, fade, tap, slap, pop,
  mixer program, volume and pan changes, and lyrics; per note the string, the fret (the MIDI note
  on drum and pitched tracks), tie, dead, ghost, hammer-on or pull-off destination, slide kinds,
  bend (point count and the first, last and highest value), harmonic kind and value, palm mute,
  let ring, vibrato, trill, staccato, accent, dynamics and both hands' fingering. Not compared,
  because alphaTab holds nothing to compare against: the short name (GP3 to GP5 have none, so
  ours is derived), notation (alphaTab's staff defaults stand in where GP3 and GP4 have no
  flags), chord-diagram fingering (alphaTab skips the bytes), chorus, reverb, phaser and tremolo
  levels (alphaTab reads past them), fret count, bend and whammy kinds (alphaTab recomputes
  them), and the swapped-accidental spelling (alphaTab keeps a force-flat or force-sharp mode).
- **Equivalences the projection settles**, so they need no tolerance: a Guitar Pro empty beat is
  `!isEmpty && notes.length === 0` on alphaTab's side, not its `isRest`; a beat's mixer tempo
  counts toward its bar's tempos, where alphaTab moves it to `masterBar.tempoAutomations`; grace
  beats, which alphaTab keeps ahead of the main beat, nest in it as `Beat.grace` does; a chord
  grid of all muted strings is no grid, on either side (the model's `null` fret is a muted string,
  so `effects.gpx`'s bare `C` chord has none); a voice of nothing but empty beats has no beats (alphaTab
  fills every voice a file leaves empty with one), and trailing voices past the first with no
  beats are dropped; a gpif drum note's articulation index resolves through the track's
  articulation list to its MIDI note; controller levels compare on alphaTab's 0 to 16 scale
  (`floor(value × 16 / 127)` of the model's); a program change on the very first beat naming the
  track's own program is dropped on both sides, since alphaTab's `Beat.finish` adds one there
  whenever the file has none.
- **Differences** come back as `{ fixture, path, field, ours, alphaTab }`, the path
  `tracks[0].bars[15].voices[0].beats[2].vibrato`; arrays of different lengths report
  `….length` and are compared up to the shorter one.
- **The tolerance list** is `test/oracle/tolerances.ts`. A difference no entry accepts fails the
  fixture's test, and an entry that accepts nothing in its formats fails too. To add one: give it
  an `id`, the `formats` it applies to, a predicate as narrow as the difference (match the field
  and both values, not the path alone), and a `why` of one or two sentences naming the source (a
  review, the score-model reference, this README's mapping decisions, or the line in alphaTab's
  reader). Add it only for a legitimate deviation; when the oracle shows a reader bug, fix the
  reader.
- **Readers** are the table in `test/oracle/readers.ts`, one `{ extension, read }` entry per
  extension. Every extension in `fixtures/` must have an entry or a pending one, and a pending
  entry fails once `@reprise/formats` exports its reader, so the oracle cannot silently skip a
  format; the pending list has been empty since gpx landed.

| Tolerance                   | Formats                | Why                                                                                                                                                                                                                            |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `grace-duration`            | gp3, gp4, gp5, gp, gpx | We read the grace duration byte (64th, 32nd, 16th); alphaTab skips it and sizes a grace by its group: one an eighth, two sixteenths, more 32nds; gpif keeps the grace beat's `Rhythm` and the same `Beat.finish` overrides it. |
| `bend-points-kept`          | gp3, gp4, gp5, gp, gpx | The model keeps the file's bend points; alphaTab's `Note.finish` rewrites a 3- or 4-point list to its detected type's shape (ends and peak survive); the same rewrite turns gpif's three-point bend-release into four.         |
| `gp3-tremolo-bar`           | gp3                    | GP3's one-depth tremolo bar is read as a three-point dip, the shape GP4 writes; alphaTab skips the depth, so it has no whammy at all.                                                                                          |
| `beat-vibrato-wide`         | gp3, gp4, gp5          | Beat-effect bit 0x02 is Guitar Pro's wide vibrato; alphaTab reads it as slight.                                                                                                                                                |
| `gp3-beat-vibrato-on-notes` | gp3                    | GP3 stores a note's slight vibrato only as beat bit 0x01, so it goes on the notes; alphaTab leaves it on the beat.                                                                                                             |
| `stroke-speed`              | gp3, gp4, gp5          | Stroke speed 1 to 6 is a 128th down to a quarter, as Guitar Pro, TuxGuitar and PyGuitarPro read it; alphaTab's table is one step slower.                                                                                       |
| `percussion-articulations`  | gp3, gp4, gp5          | Drum notes keep the GM note (27, 28, 32 are GM2's High Q, Slap, Square Click); alphaTab maps those three to its own articulation indices.                                                                                      |
| `voltas-on-every-bar`       | gp3, gp4, gp5, gp, gpx | The model numbers every bar of a volta bracket; alphaTab marks its first bar only, in gpif too.                                                                                                                                |

Seen in review but not in the list, because no fixture shows them: alphaTab keeps a
lyric line's leading and trailing spaces as empty syllables, and leaves the compound-time duplet,
quadruplet and octuplet without a denominator. They become entries when a fixture carries them.

## gp writer

```ts
import { writeGp, writeGpif } from '@reprise/formats';

const { bytes, dropped } = writeGp(score); // a .gp file Guitar Pro 7 and 8 open
const { xml } = writeGpif(score); // just the score.gpif document
```

Both are synchronous and deterministic: ids are sequential per gpif section and the zip entries carry a fixed timestamp, so one score always gives the same bytes. `dropped` lists the score features the file cannot carry, one `GpifDropped` (`{ code, message, path, count }`) per kind of loss with the first model path it was found on (`score.tracks[0].bars[2].voices[0].beats[1]`); it is what the export dialog (WP-061) shows. The `write()` dispatcher (WP-045) wraps `writeGp`.

`src/gpif/write-gpif.ts` is the inverse of the reader's mapping; `write-tracks.ts`, `write-notes.ts` and `write-tempo.ts` hold the track, note and tempo parts, and `xml-writer.ts` a small serializer (escaped text, CDATA for free text, one element per line as Guitar Pro writes them). `src/gp/write-gp.ts` assembles the zip.

### What is written

Everything in the coverage table above that the model holds, in the shape the reader reads and Guitar Pro writes:

- **Score** metadata (notices joined by line), **MasterTrack** with the track order, the pickup flag and the tempo automations: every `MasterBar.tempo` and `Beat.mix.tempo`, with its unit (`"<value> <unit>"`, the value divided back from quarter-note BPM) and label. A ramp (`Beat.mix.tempo.duration`) becomes gpif's pair: an automation at its start holding the tempo in effect and a linear one `duration` quarter notes later holding the target, which the reader turns back into the ramp.
- **Tracks**: name, short name, colour, playback state (solo, mute), instrument set, octave transposition, channel strip (volume and pan as RSE parameters 12 and 11), sounds and `Sound` automations for `Beat.mix.program`, the raw lyric block (`dispatched` when beats carry their own lyrics), and one staff with capo, fret count, the tuning lowest string first with Guitar Pro's `Instrument` name, and a diagram collection deduplicated by structure (fingers as `Thumb`, `Index`, `Middle`, `Rank`, `Pinky`, Guitar Pro's own spelling). A drum kit is Guitar Pro's: its elements (snare, hi-hat, kicks, toms, cymbals, hand percussion) with their soundbank names and articulations (name, RSE sound, GM2 note), then an unpitched element for the GM2 sounds Guitar Pro has no element for and any other note the track plays; notes index the articulations across elements. A drum staff carries the capo and fret properties too, as Guitar Pro writes them.
- **MasterBars**: time, key, repeat with its total plays, alternate endings (on the first bar of each bracket, as gpif marks them), directions from `jumps` and `targets`, section letter and name, triplet feel, double bar.
- **Bars** with the clef in effect on every bar, **Voices** (an empty voice is `-1`), **Beats** with a deduplicated `Rhythms` table by note value, dots and tuplet, the beat's dynamic, grace beats before their beat (`BeforeBeat`/`OnBeat`), text, chord, lyrics, fades, tremolo picking, arpeggio, brush, pick stroke, slap, pop, whammy-bar vibrato, the whammy curve and the stroke length `XProperty`.
- **Notes**: string (counted from the lowest) and fret, the sounding `Midi` number, the concert-pitch accidental when one is stored, tapping, harmonics with their fret, dead, palm mute, bends (offsets ÷ 0.6, values × 25), slides as bit flags, both ends of a hammer-on (the origin found as the reader would search back to it), both ends of a tie (the origin where the model's `tieOriginOf` finds it, up to three bars back), let ring, ghost, staccato and accents, vibrato, the trill as a MIDI value, both hands' fingers (`P I M A C`), and `InstrumentArticulation` on every note (0 off a drum kit), as Guitar Pro writes it. Keyboard notes carry `Midi`, plus the string and fret Guitar Pro 7 fingers them on when the track keeps a tuning, or GP6's octave and tone when it does not.

### Dropped

What a score can hold and gpif cannot. Practice data never reaches the writer; nothing here is practice data.

| Code                    | Dropped                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `section-color`         | `Section.color`                                                                                                                                                                                                                                              |
| `channel-effect`        | `channel.chorus`, `reverb`, `phaser`, `tremolo` away from 0                                                                                                                                                                                                  |
| `mixer-change`          | `Beat.mix` volume, pan and effect changes; a second program change at one moment of a track                                                                                                                                                                  |
| `sound-override`        | `Track.sound`, the HQ tier's assignment                                                                                                                                                                                                                      |
| `note-dynamics`         | different dynamics on notes of one beat (gpif has one per beat; the first note's is kept)                                                                                                                                                                    |
| `stroke`                | a beat with both a brush and an arpeggio (gpif has one stroke per beat; the brush is kept)                                                                                                                                                                   |
| `fade`                  | more than one of fade in, fade out, volume swell on a beat                                                                                                                                                                                                   |
| `tapping-without-notes` | `effects.tapping` on a beat without notes (gpif marks tapping on notes)                                                                                                                                                                                      |
| `empty-beat`            | an empty beat (`rest: false`, no notes) among a voice's played beats becomes a rest; a voice of nothing but empty beats (GP5's unused voice) is left out silently, as Guitar Pro 7 writes an unused voice                                                    |
| `bend-shape`            | a bend of more than four points, two middle points at different values, or a kind its curve does not show                                                                                                                                                    |
| `whammy-shape`          | the same for a whammy curve                                                                                                                                                                                                                                  |
| `trill-speed`           | a trill speed other than sixteenths                                                                                                                                                                                                                          |
| `trill-range`           | a trill whose other note is past MIDI 127                                                                                                                                                                                                                    |
| `chord-barre`           | barres that no single finger spans in the fingering, an all-empty fingering, a finger on a muted string                                                                                                                                                      |
| `volta-bracket`         | a bracket layout the reader cannot rebuild from first-bar marks (a final ending followed by unmarked bars and a repeat end)                                                                                                                                  |
| `anacrusis`             | `anacrusis` on a bar other than the first                                                                                                                                                                                                                    |
| `notation`              | a drum or keyboard track not on standard notation; a fretted track with a non-guitar program on standard notation only (it gets tablature, or it would read back as a keyboard); a keyboard track with a guitar program and a tuning (it reads back fretted) |
| `capo`                  | a capo on a drum or keyboard track: the notes are fingered without one, so `CapoFret` stays 0 or Guitar Pro would sound them a capo higher                                                                                                                   |
| `tempo-ramp`            | a ramp cut short by the next change, ending past the score, between beats, or on a different mark; written as a step                                                                                                                                         |
| `tempo-collision`       | two different tempo changes at one moment; playback's winner is written                                                                                                                                                                                      |
| `notices`               | a lone empty notice, or one holding a line break                                                                                                                                                                                                             |
| `text-characters`       | characters XML cannot hold (C0 controls, lone surrogates), removed                                                                                                                                                                                           |

`fullScore()` drops exactly `section-color`, `channel-effect`, `sound-override`, `chord-barre`, `mixer-change`, `stroke`, `note-dynamics` and `trill-speed`; the gp and gpx fixtures and `largeScore()` drop nothing.

### The zip

The entries and their order are Guitar Pro 7's own (`unzip -l` on the fixtures): `Content/` (stored), `Content/BinaryStylesheet`, `Content/LayoutConfiguration`, `Content/PartConfiguration`, `Content/Preferences.json`, `Content/score.gpif`, `VERSION` (`7.0`). The non-score entries are **generated**, not copied: the fixtures' entries are Guitar Pro's own boilerplate, but they come from MPL-licensed test data and a generated entry is small and says only what we mean.

- `PartConfiguration`: the full score view with one flag byte per track (1 standard, 2 tablature), then one single-track view per track and the selected view, as Guitar Pro writes it. It carries `display.notation` and half of the reader's keyboard-track rule.
- `LayoutConfiguration`: zoom 4, page view, then a visibility byte for each track in each of those views, then the selected track; the shape of every fixture's entry.
- `BinaryStylesheet`: fifteen page and system settings with the values Guitar Pro 7 writes by default (the fixtures carry about 590); Guitar Pro fills the rest from its defaults, as it does for alphaTab's exports, which write about a dozen.
- `Preferences.json`: the playback preferences of a new file, every option off. The reference sketch calls it `Preferences.xml`; every fixture has `Preferences.json`.

### Verification

There is no Guitar Pro here, so two readers stand in for it (`test/gp-writer.test.ts`, `test/gp-writer-oracle.test.ts`):

- **Round trip through our reader**: every gp fixture, `largeScore()` plain and structured, and a hand-built score with every feature gpif can carry on all three track kinds (`test/kitchen-sink.ts`) read back equal, with nothing dropped; `fullScore()` reads back equal to itself with exactly its known losses applied; every gp3, gp4, gp5 and gpx fixture exports with only the losses above (marker colours, GP5's empty beats, long bend curves). The comparison (`test/gp-round-trip.ts`) normalises only what the reader legitimately places differently: ids, clefs as the clef in effect per bar, tempo and program changes as one list per moment (a beat-level change can come back on another track's beat at the same moment, and a ramp's end comes back as a mark), slide flags and barres as sets, and floats to 1e-6.
- **alphaTab** (1.8.4, dev-only) loads every written file with the same tracks, bars, notes, track names and opening tempo, and its reading projects (the oracle's reduction of a score, `test/oracle/`) the same as our reader's reading of the same bytes, for all 27 fixtures (the gp3, gp4, gp5 and gpx ones exported), `fullScore()`, the kitchen-sink score and a structured `largeScore()`. The comparison uses the oracle's gp tolerances plus a list of the writer's own in `test/gp-writer-oracle.test.ts`, each pinned to a line in alphaTab or the oracle and each required to accept at least one difference: CRLF notices, split CDATA, a harmonic without a fret, hammer-ons on string-less piano notes, lyric blocks beside beat lyrics, a program change on the first beat, ramps, and a double bar on the last bar.
- Every drop code has its own test, and the zip's entry list, part configuration and layout sizes are checked.

Measured on an Apple M4 Pro, Node 24, after warm-up:

| Input                              | gpif    | `writeGpif` | `writeGp` (with deflate) | `.gp` size |
| ---------------------------------- | ------- | ----------- | ------------------------ | ---------- |
| `drum-tabs.gp`, read then written  | 73 KB   | 0.8 ms      | 1.5 ms                   | 7 KB       |
| `largeScore(8, 300)`, 38,400 notes | 13.1 MB | 139 ms      | 313 ms                   | 530 KB     |

The large-score timing and size are asserted with loose bounds for CI.

### Known gaps

- **Guitar Pro itself has not opened these files.** alphaTab's acceptance is the proxy, and the structure follows the GP7 fixtures and alphaTab's own exporter where the two agree. What differs from a file Guitar Pro writes, by design: no page layout, score views, RSE effect chains or per-track layout; sound paths `Midi/<program>` with no RSE bank. Two differences a reader change would close: `ConcertPitch` is written only for a stored accidental and `TransposedPitch` never, while Guitar Pro writes both on every note (the reader turns any `ConcertPitch` into an explicit `Note.accidental`, so writing them everywhere must wait for a reader that keeps only accidentals that differ from the key's spelling); and a three-point bend or whammy curve is written with `MiddleOffset1` only, where Guitar Pro writes `MiddleOffset2` as well (the reader would turn that into four points). A check in a real Guitar Pro 7 or 8 is an open question on the PR.
- Our reader reports three `not-modelled` warnings on every file the writer makes (`RSE`, `MidiConnection`, `AudioEngineState`): elements written for Guitar Pro's playback that the model does not keep. A ramp that starts mid-bar also draws the reader's "starts from the tempo before it" warning, though it comes back where it was.
- A keyboard track's notes are fingered on the highest string that reaches them, for Guitar Pro's tablature view; the reader ignores the fingering.
- Volta numbers are written on each bracket's first bar; a bracket the reader would carry too far is written on every bar, which Guitar Pro draws as separate brackets.

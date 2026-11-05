# @reprise/formats

File import and export for Reprise: Guitar Pro files in, `.reprise` and `.gp` out. The frozen
contract (`detect`, `read`, `write`, `Warning`) is in
[`docs/specs/architecture.md`](../../docs/specs/architecture.md), "Contracts"; the formats
themselves are described in [`docs/reference/file-formats.md`](../../docs/reference/file-formats.md),
and the reader conventions every format follows are in
[`docs/reference/score-model.md`](../../docs/reference/score-model.md), "Reading and writing
Guitar Pro files". The package imports `@reprise/model` and `fflate` (the gp zip, pinned) and nothing else, and
runs anywhere: no DOM, no Node APIs.

| Format          | Reader              | Work package |
| --------------- | ------------------- | ------------ |
| gp3, gp4, gp5   | `readGp3To5` (here) | WP-040       |
| gp (GP7 and 8)  | `readGp` (here)     | WP-042       |
| gpx (GP6)       | `readGpx` (here)    | WP-043       |
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

## gp (GP7/8) and gpif

```ts
import { readGp, readGpif } from '@reprise/formats';

const { score, warnings } = readGp(bytes); // a .gp file
const fromXml = readGpif(xml, { partConfiguration }); // score.gpif from any container
```

- `src/gp/` is the Guitar Pro 7 and 8 container: a zip read with `fflate` (pinned, the package's one runtime dependency besides the model). Only `Content/score.gpif` and `Content/PartConfiguration` are inflated, and only when the central directory declares them under 256 MB, since fflate allocates the declared size up front; the stylesheets, layout and preferences are Guitar Pro's view state.
- `src/gpif/` is the XML model shared with Guitar Pro 6. `readGpif` takes the document as a string or UTF-8 bytes, plus the container's `PartConfiguration` bytes when it has them. The gpx container finds those two entries in its file system and calls it (see "gpx (GP6)" below).
- Reading runs in two passes: `read-document.ts` turns every section into id-keyed maps (`GpifDocument`), and `build-score.ts` resolves the references into a score through the model's factories and `newId()`, then runs `validateScore` and reports each violation as a warning.
- Both readers are synchronous; the async `read()` dispatcher of the Formats contract (WP-045) wraps them.
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

Every `fixtures/gp/*.gp` matches the manifest's track, bar and note counts, shows exactly the manifest's feature flags in the model, raises no `unknown-element` warning, and round-trips through `serializeNative`/`parseNative` unchanged. A throwaway comparison with alphaTab 1.8.4 also matched per bar and voice: every beat's duration, dots and tuplet and every note's string, fret and tie, the drum notes' GM sounds, the tempo automations and the track colours and volumes. The formal oracle test is WP-041's.

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

**Fixtures.** Every `fixtures/gpx/*.gpx` matches the manifest's track, bar and note counts and feature flags, raises no `unknown-element` warning, is schema-valid and round-trips through `serializeNative`/`parseNative` unchanged (`test/gpx-fixtures.test.ts`). `effects`, `key-signatures` and `repeat-close-alternate-endings` exist as gp5 too, and both reads agree on every sounding beat's rhythm, every note's string, fret and tie, and the master bars' time, key, repeats and voltas; GP6 only padded short bars with rests when it resaved them. A throwaway comparison with alphaTab 1.8.4 matched per bar and voice on every beat's duration, dots and tuplet and every note's string, fret and tie, except that alphaTab reports `effects.gpx`'s four 32nd grace notes as eighths, where the file says `32nd`. No gpx fixture has a drum track, so the drum mapping is covered by hand-built documents in `test/gp6-differences.test.ts`; the container by hand-built BCFZ streams and BCFS images (`test/gpx-builder.ts`, `test/gpx-container.test.ts`).

**Timing** (Apple M4 Pro, Node 24, after warm-up): `effects.gpx` (28 KB, the largest) reads in 1.3 ms, 0.3 ms of it decompression; a synthetic 4 MB stream decompresses in 39 ms, about 100 MB/s. The fixture bound is asserted loosely for CI.

**Known gaps.**

- The GP6 drum sounds follow alphaTab, which plays the ride's third variant (the bell) as GM 59 (ride cymbal 2) rather than 53 (ride bell), and every cowbell as 56. Not checked against Guitar Pro 6 itself.
- `BinaryStylesheet`, `LayoutConfiguration` and `misc.xml` are not read (page and system layout, view state).
- `effects.gpx` holds three overfull voices (bars 4, 6 and 24) and a 5:2 rest tuplet (bar 29), which alphaTab reads the same way; they are reported as invariant warnings.

**Errors and warnings.** `GpxError` with `code`: `not-bcfz` (neither magic), `truncated` (the stream or the file system ends before data the header declared), `too-large` (a declared length over 256 MB), `corrupt` (a back-reference before the output's start or at distance zero, a block or size past the declared image, an image without `BCFS`), `missing-score` (no `score.gpif`). A `score.gpif` that cannot be read throws the gpif reader's `GpifError`. New warnings, all through the gpif catalogue's codes: `drum-articulation` and `unknown-value` for GP6 drum pairs, `unknown-value` for an unknown note accidental word, `not-modelled` for `Bank` and `AutoBrush`.

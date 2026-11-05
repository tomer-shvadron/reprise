# @reprise/formats

Readers and writers between Guitar Pro files and the `@reprise/model` score. The format notes are in [`docs/reference/file-formats.md`](../../docs/reference/file-formats.md); the model mapping rules every reader follows are in [`docs/reference/score-model.md`](../../docs/reference/score-model.md), "Reading and writing Guitar Pro files".

## gp (GP7/8) and gpif

```ts
import { readGp, readGpif } from '@reprise/formats';

const { score, warnings } = readGp(bytes); // a .gp file
const fromXml = readGpif(xml, { partConfiguration }); // score.gpif from any container
```

- `src/gp/` is the Guitar Pro 7 and 8 container: a zip read with `fflate` (pinned, the package's one runtime dependency besides the model). Only `Content/score.gpif` and `Content/PartConfiguration` are inflated, and only when the central directory declares them under 256 MB, since fflate allocates the declared size up front; the stylesheets, layout and preferences are Guitar Pro's view state.
- `src/gpif/` is the XML model shared with Guitar Pro 6. `readGpif` takes the document as a string or UTF-8 bytes, plus the container's `PartConfiguration` bytes when it has them. The gpx container (WP-043) only has to find those two entries in its file system and call it.
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
- **Hammer-ons** are flagged at both ends (`HopoOrigin`, `HopoDestination`); the destination flag is the model's, and an origin whose destination is unflagged moves to the next note on its string in the voice.
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
- **GP6 forms** handled here for WP-043: track-level `Properties`, `GeneralMidi` with the percussion table, the `Whammy` element with attributes, `Instrument ref` ending in `-gs` for a second staff, and `Octave`/`Tone` note pitches. A GP6 drum note has no `InstrumentArticulation`, so its `Midi` number is kept as the sound; GP6 numbers variants like GP7's articulation inputs (91 and up), so one outside GM percussion (27 to 87) is reported with `invalid-value`, and mapping `Element`/`Variation` to the GM sound is WP-043's.

### Known gaps

- **Multiple staves** collapse onto one (ADR-0006): staff 1 keeps its voice slots and the voices of later staves fill the empty ones, dropped with `voice-dropped` when none is free. The other staves' tunings and capos are not read.
- **Linear tempo ramps** become a ramp starting at the previous automation with `duration` rounded to whole quarter notes (`MixTransitionSchema` is an integer); a ramp that starts mid-bar starts from the tempo before it. No fixture has one.
- **Tempo automations between beats** move to the beat sounding at that moment (`tempo-moved`), as in `beat-tempo-change.gp` bar 2.
- **Drum articulation variants** (rim shot, choke, half-open) play as their GM sound and are reported once per track; the model has no articulation field.
- **Grace notes** longer than a 16th or shorter than a 64th are clamped; a grace beat's own effects are not kept.
- **Not read**: track and staff layout, RSE settings, MIDI routing, ottavas, chromatic transposition, partial capo, tuning labels and flat display, fermatas, free time, beam grouping, hairpins, legato slurs, timers, golpe, rasgueado, wah, dead slaps, slashed beats, barre marks, staccatissimo, tenuto, left-hand tapping, ornaments, pick slides, nested tuplets, sustain pedal, backing tracks, the chord wizard's data. Each is reported as `not-modelled`. A drum note's `Element` and `Variation` properties repeat what `InstrumentArticulation` says and are read silently.
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
| `voice-dropped`                   | a further staff's voice with no free slot                                                      |
| `simile-expanded`                 | a simile bar, filled with a copy of the bar it repeats                                         |
| `grace-without-beat`              | grace beats at the end of a voice with no beat after them                                      |
| `grace-duration-clamped`          | a grace note outside 16th to 64th                                                              |
| `hammer-pull-without-destination` | a hammer-on origin with no later note on its string                                            |
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

About 130 to 270 MB/s and linear in size, so the parser is not where import time goes; the long score's read leaves most of the 500 ms drop-to-first-paint budget to layout. The fixture timing is asserted in `src/gp/read-gp.test.ts` with a loose bound for CI.

# File formats

Notes for the formats lane. The authoritative descriptions of the Guitar Pro formats are reverse-engineered by the community; the two most complete open implementations are alphaTab (TypeScript, MPL-2.0) and TuxGuitar (Java, LGPL). Read them to understand the structures; **re-implement from understanding, do not copy code**, so our package keeps its own license posture.

## Family overview

| Extension | Produced by      | Container                                   | Payload                       | We read | We write     |
| --------- | ---------------- | ------------------------------------------- | ----------------------------- | ------- | ------------ |
| `.gp3`    | Guitar Pro 3     | none                                        | binary, versioned sections    | yes     | no           |
| `.gp4`    | Guitar Pro 4     | none                                        | binary, gp3 plus extensions   | yes     | no           |
| `.gp5`    | Guitar Pro 5     | none                                        | binary, gp4 plus extensions   | yes     | phase 2      |
| `.gpx`    | Guitar Pro 6     | BCFZ-compressed BCFS virtual file system    | `score.gpif` XML              | yes     | never        |
| `.gp`     | Guitar Pro 7, 8  | zip                                         | `Content/score.gpif` XML      | yes     | yes (v1)     |
| `.reprise`| Reprise          | none                                        | JSON, versioned               | yes     | yes (native) |

## gp3, gp4, gp5

- Starts with a Pascal string version header such as `FICHIER GUITAR PRO v3.00`, `v4.06`, `v5.00`, `v5.10`. Branch on it.
- Strings are either byte-length-prefixed or int-length-prefixed with a byte sub-length; the encoding is a legacy single-byte code page (treat as windows-1252 by default).
- Section order: header and metadata, lyrics (gp4+), RSE master settings (gp5), page setup (gp5), tempo (with a name in gp5), key and octave, MIDI channels (64 entries), directions and master reverb (gp5), counts of master bars and tracks, master bars, tracks, then per master bar per track the bars, each with one voice (gp3, gp4) or two voices (gp5) of beats.
- Beat: a flags byte selects which optional blocks follow (dotted, chord diagram, text, effects, mixer change, tuplet); a duration byte; the string bitmask of notes present; then one note block per set string.
- Note: flags byte, note type (normal, tie, dead), dynamics, fret, fingering, then an effects block if flagged (bend with a point list, grace, slide, harmonic, trill, tremolo picking, let ring, hammer, staccato, palm mute, vibrato).
- gp5 adds: a second voice block per bar, note and beat flag extensions, more harmonic kinds, a padding byte after certain structures, track RSE blocks, and a different tuplet and chord-diagram layout. These are the places where most reader bugs live; the fixture manifest marks files per version.
- Repeats, alternate endings, markers, triplet feel and key changes live on master bars; mixer changes and tempo changes also appear on beats and must be applied to the model's `mix` field.

## gpx (Guitar Pro 6)

- Magic `BCFZ` then an int of uncompressed length, then a bit stream: each chunk starts with a bit that selects a raw block (two bits of length-length, then the length, then raw bytes) or a back-reference (four bits of offset-length, then offset and length into already-decoded output, LZ-style).
- The decompressed payload is a `BCFS` file system: 4-byte magic, then sectors of fixed size; sector 1 onward holds entries of type file or directory with a name, size and a list of block indices. Extract `score.gpif`.
- The `gpif` XML is the same vocabulary as Guitar Pro 7's with small differences in a handful of element names and the absence of newer properties. One reader with a version switch.

## gp (Guitar Pro 7, 8)

- A zip with `Content/score.gpif`, `Content/BinaryStylesheet`, `Content/LayoutConfiguration`, `Content/PartConfiguration`, `Content/Preferences.xml`, `VERSION`, and an optional `Content/Image*` set. Only `score.gpif` matters to us; write the others minimally when exporting so Guitar Pro accepts the file.
- `gpif` structure: `GPIF > Score` (metadata), `MasterTrack` (tracks list, automations such as tempo), `Tracks > Track` (name, color, instrument set with the `Staves` and `Properties` including `Tuning`, `CapoFret`, `DiagramCollection`), `MasterBars > MasterBar` (`Time`, `Key`, `Repeat`, `AlternateEndings`, `Directions`, `Section`, `TripletFeel`, `Bars` id list), `Bars > Bar` (`Clef`, `Voices` id list), `Voices > Voice` (`Beats` id list), `Beats > Beat` (`Rhythm` ref, `Notes` id list, `Properties`, `Lyrics`, `Chord`, `Legato`, `Whammy`, `Tremolo`), `Notes > Note` (`Properties` with `String`, `Fret`, `Bended`, `BendOriginValue`..., `Slide`, `HopoOrigin`, `HopoDestination`, `HarmonicType`, `PalmMuted`, `LetRing`, `Vibrato`, `Tie`, `Accent`, `LeftFingering`), `Rhythms > Rhythm` (`NoteValue`, `AugmentationDot`, `PrimaryTuplet`).
- Everything is id-referenced; build maps first, then resolve.
- `MasterBar > SimileMark` (`Simple`, `FirstOfDouble`, `SecondOfDouble`) is not in the model. The reader expands the previous bar's beats (for the double form, the two bars before it) into the bar with fresh ids and records a warning; export does not reproduce the mark, the expanded bars are written instead.

## `.reprise`

- JSON object `{ format: 'reprise', version: 1, app: { name, version }, score }` where `score` validates against the model's Zod schema. Stable key order, two-space indentation, UTF-8. No compression.
- Migrations keyed by `version`. A newer version than the app knows fails with a message naming the versions.

## Oracle

alphaTab is a dev-only dependency. It is used to (a) describe fixtures for the manifest, (b) compare parse results note by note, and (c) read back files our gp writer produces. The lint boundary `alphatab-only-in-oracle-tests` (root `eslint.config.js`) lets it be imported only under `packages/formats/test/` and `scripts/`, statically or with `import()`; anywhere else, test files of other packages and `packages/formats/src` included, the import fails lint with a message naming the boundary. Two places use it: `scripts/fixtures/describe.ts`, which `pnpm fixtures:check` runs in CI, and the oracle test in `packages/formats/test/oracle/`, which runs in `pnpm test` (its harness and tolerance list are described in `packages/formats/README.md`, "Oracle").

**Verify format facts against alphaTab's readers, not memory.** Before the formats lane builds a model mapping on a claim about what a format carries, it checks the claim in `node_modules/@coderline/alphatab/dist/alphaTab.core.mjs`: the gpif parser (`_parseRhythm`, the automation parser) and the `Gp3To5Importer`'s beat and note readers. The review of WP-010 (PR #19) found three facts the sketch had wrong from memory:

- gpif `NoteValue` runs from `Long` (a quadruple whole) through `DoubleWhole`, `Whole`, `Half`, `Quarter`, `Eighth`, `16th`, `32nd` and `64th` to `128th` and `256th`. The model's `Duration` covers 1 to 256; a reader ties the two longer values.
- A gpif tempo automation's `Value` is `"<bpm> <unit>"`, with `unit` 1 to 5 meaning eighth, quarter, dotted quarter, half and dotted half. The reader multiplies by 0.5, 1, 1.5, 2 and 3 to get quarter-note BPM for `TempoMark.bpm` and keeps the unit in `TempoMark.unit`.
- The gp3 to gp5 bend block carries a vibrato byte after every point (offset, value, vibrato). The reader consumes it; the model does not keep it.

## Open-licensed fixture sources

- alphaTab test data in its repository under `test-data/` (MPL-2.0; check each file's own provenance, some are hand-made by the project).
- TuxGuitar's test and example files (LGPL; same check).
- Hand-built fixtures produced by our own writer once it exists, which are the only ones we fully own.

No commercial tabs are ever committed. Tomer's downloaded tabs live in `local-tabs/`, which is gitignored.

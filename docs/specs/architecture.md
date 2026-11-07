# Architecture

The package map, the allowed dependencies between packages, the contracts the lanes code against, and the runtime shape. An agent working on one package needs this file to know what it may import and what it must expose.

## Packages

```
reprise/
  packages/
    model/      @reprise/model     score data model, IDs, timing, commands, history, native format
    formats/    @reprise/formats   gp3/gp4/gp5, gp, gpx readers; gp writer; format detection
    layout/     @reprise/layout    score -> positioned glyphs + hit-testing geometry
    audio/      @reprise/audio     sampler, scheduler, SF2/SFZ loaders, effects, memory manager
  apps/
    web/        @reprise/web       React app: painter, transport, library, trainer, editor UI
    desktop/    @reprise/desktop   Electron main + preload, platform adapter, packaging
  fixtures/                        open-licensed test files and their provenance
  docs/
```

### Allowed dependency edges

```
formats  -> model
layout   -> model
audio    -> model
web      -> model, formats, layout, audio
desktop  -> web (types only, for the preload bridge)
model    -> (no workspace dependencies)
```

Enforced by lint. In addition:

- `packages/*` may not import `react`, `react-dom`, or any package that needs a DOM at import time. `audio` may use Web Audio types; its tests run in a browser-like environment, not jsdom.
- `formats`, `layout` and `audio` never import each other. If two of them need the same helper, it lives in `model` or is duplicated. That isolation is what makes the lanes independent.
- `web` is the only place engines are wired together.

### Feature folders in `web`

```
apps/web/src/
  app/            shell, routing, theme, command palette, keyboard map, services (the stores wired together)
    audio/        the audio service: AudioContext, GM bank, sampler, memory manager, engine
  platform/       Platform interface + browser and electron implementations
  state/          zustand stores: document, selection, playback, layout (derived), ui
  features/
    score/        SVG painter, cursor overlay, selection rendering, print view     (score lane)
    transport/    transport bar, tempo, loop, count-in, metronome controls         (lead)
    tracks/       track sidebar, mixer                                             (lead)
    library/      library screen, import, save/export flows                        (formats lane)
    trainer/      speed trainer, tuner, standalone metronome, practice log, fretboard (app lane)
    editor/       note entry, palettes, dialogs, clipboard, undo UI                 (score lane)
    sounds/       sound pack manager                                               (audio lane)
```

A lane owns its feature folder the same way it owns its package.

## Data flow

```
file bytes --formats.read--> Score --------+--> layout.layout(score, options) --> LayoutResult --> web/features/score (SVG)
                                           |
  Command --model.apply--> patches --------+--> layout re-layout of dirty bars
                                           |
                                           +--> audio.schedule(score, playbackSequence, tempoMap) --> Web Audio graph
                                                     |
                                                     +--> position events --> cursor, fretboard, practice log
```

- The **document store** holds the current `Score`, the undo history and the selection. All edits go through commands.
- **Layout** is a pure function of the score and view options, cached per bar; a patch marks bars dirty and only those re-flow, systems within three bars of a re-measured bar are rebuilt, re-breaking stops where the breaks re-converge, and the rest are reused.
- **Audio** reads the score through the tempo map and the playback sequence; it never holds a reference to React state.
- **Mixer**: volume, pan and instrument are score edits through `setTrackProperties`; mute and solo are the audio service's per-song overrides; visibility and single-track view are the document's view state, and notation per track is view state that Save writes into the file (ADR-0024). A timeline-neutral edit reaches the sampler without rebuilding the sequence.

## Contracts

**Frozen on 2026-11-05 at WP-015.** Changes after this date are `type:contract` issues owned by the lead.

Changed by #62 (2026-11-05): a tie's origin is the most recent note on its string in its voice within three bars, not only the previous beat (`tieOriginOf`, `TIE_REACH_BARS`); `newId()` draws its random bytes from a pooled buffer, with the same format and distribution. Widened by #65 (2026-11-05): `tieChainOf`, the forward walk in score order, is exported; a grace note may not carry `tie` (`GraceNoteSchema`); `ChannelMixChange.duration` counts quarter notes, the unit the #66 review ruled; and the audio sink contract (`packages/audio/README.md`) gains `InstrumentSink.mix?(MixEvent)` for beat-level mixer changes, replayed at each run start, and `NoteEvent.continuations`, the tied links folded into an onset.

Changed by #82 (2026-11-06): `write` takes an optional third argument, `write(score, format, options?: { app?: AppInfo })`, the app stamped into a `.reprise` file, defaulting to `{ name: 'reprise', version: '0.0.0' }`.

Changed by #79 (2026-11-06): a region map resolves every layered region of a key and velocity (`RegionMap.resolveAll`) and a note starts one voice per region behind one handle; `Region` gains `filter` (a static low-pass at the filter envelope's held level, its resonance lowering the DC gain by half its peak) and `exclusiveClass` (choke groups within a track's instrument), `Envelope` gains `delay`; the voice pool stays a hard cap and ranks stealing victims by their audible level, articulation gain included, taking a voice that starts with or after the new note only when no other is left; `Sampler.setInstrument` takes an optional time, `Sampler.instrumentAt(trackId, when)` returns the instrument a note at `when` plays, and `Sampler.allNotesOff` drops the instrument changes scheduled after its time; the sampler sink switches a track's instrument from `InstrumentSink.mix` (`MixEvent.mix.program`) through its `instrumentOf` option.

Changed by #96 (2026-11-06): `OpenedFile` (and the `file:open` result) gains an optional opaque `handle`, the picked path in Electron and the `FileSystemFileHandle` in a browser with the File System Access API, and `Platform` gains `writeHandle(handle, bytes)`, which writes over that file or over a path `saveFile` returned; Save writes a `.reprise` in place through it, and a `.gp` with the gp writer once the user confirms what it loses; gp3, gp4, gp5 and gpx have no writer of their own, so Save sends them to Save As, which asks for Reprise or Guitar Pro 7–8 before the platform dialog.

Synced by #74 (2026-11-06), no contract change: the Layout sketch lists the `LayoutOptions`, `LayoutMetrics` and `Anchor` fields #59 shipped and the `tiedNotes` option #68 added, and the Audio sketch names the `InstrumentSink` #55 shipped and #73 widened.

The lanes code against these. The model subsections below are drawn from `@reprise/model`'s source and match its root export; [`../reference/score-model.md`](../reference/score-model.md) explains them in prose and `packages/model/README.md` records why each decision was made. Formats, Layout, Audio and Platform are the sketches their phases implement.

**Diagnostics** carry kebab-case identifiers. An invariant violation keys its kind as `rule` (`Violation`); a warning or an error keys it as `code` (`ParseWarning`, `PlaybackWarning`, `CommandWarning`, `CommandError`, `NativeFormatError`). Model enum values (`slight`, `doubleFlat`, `belowOpenString`) stay camelCase: they are data, not diagnostics.

### Score model (`@reprise/model`)

Zod schemas with the TypeScript types derived from them (`z.infer`), so the two cannot drift; every type below has a `…Schema` beside it (`ScoreSchema`, `NoteSchema`, …). Optional fields are exact: absent means "not set", and an explicit `undefined` is rejected. Ranges are the schemas' (`1..32` is an inclusive integer range).

```ts
type Id = string;                // 12 base62 characters from newId(); IdSchema, ID_LENGTH, ID_PATTERN
type Color = string;             // lower-case #rrggbb

interface Score {
  id: Id;
  meta: { title; subtitle; artist; album; words; music; copyright; tab; instructions: string; notices: string[] };
  masterBars: MasterBar[];       // at least one; one per bar position, shared by every track
  tracks: Track[];               // at least one
}

interface TempoMark {
  bpm: number;                   // > 0, always per quarter note, whatever `unit` displays
  unit?: 'eighth' | 'quarter' | 'dottedQuarter' | 'half' | 'dottedHalf';   // display only; absent = quarter
  label?: string;
}

interface MasterBar {
  id: Id;
  timeSignature: { numerator: 1..32; denominator: 1 | 2 | 4 | 8 | 16 | 32 };
  keySignature: { fifths: -7..7; minor: boolean };    // sharps positive, flats negative
  tempo?: TempoMark;                                   // a change at the start of this bar
  repeat: { start: boolean; endCount: number };        // total plays of the section, 2 = play twice; 0 = no repeat end
  alternateEndings: number[];                          // volta numbers 1..8 (ALTERNATE_ENDING_MAX), ascending, on every bar of the bracket
  jumps: { kind: JumpKind }[];                         // read at the end of the bar; usually none or one, applied in order
  targets: ('segno' | 'segnoSegno' | 'coda' | 'doubleCoda' | 'fine')[];   // where a jump lands, or stops
  section?: { name: string; letter?: string; color?: Color };
  tripletFeel: 'none' | 'eighth' | 'sixteenth' | 'dottedEighth' | 'dottedSixteenth' | 'scottishEighth' | 'scottishSixteenth';
  doubleBar: boolean;
  anacrusis: boolean;                                  // pickup bar: not counted, skipped by the count-in
}
type JumpKind =
  | 'daCapo' | 'dcAlCoda' | 'dcAlDoubleCoda' | 'dcAlFine'
  | 'dalSegno' | 'dsAlCoda' | 'dsAlDoubleCoda' | 'dsAlFine'
  | 'dalSegnoSegno' | 'dssAlCoda' | 'dssAlDoubleCoda' | 'dssAlFine'
  | 'toCoda' | 'toDoubleCoda';

interface Track {
  id: Id;
  name: string; shortName: string; color: Color;
  kind: 'fretted' | 'drums' | 'pitched';
  tuning: number[];              // open-string MIDI notes 0..127, lowest string first, up to MAX_STRINGS (10); empty on drums.
                                 // A GP5 keyboard track is read as pitched and keeps its tuning and fretCount for gp5 export
  capo: number;                  // >= 0; frets count from the capo
  fretCount: number;             // neck length, 24 by default; 0 on drums
  program: number; bank: number; // GM program 0..127 and bank 0..16383; on drums, program is the GM2 kit
  channel: { volume; pan; chorus; reverb; phaser; tremolo: number; mute: boolean; solo: boolean };   // 0..127, pan 64 = centre
  display: { notation: 'tab' | 'standard' | 'both'; clef?: Clef; octaveShift: number };   // clef absent = treble, percussion on drums; octaveShift: written minus sounding, in octaves (1 fretted, 0 otherwise)
  sound?: { packId?: Id; preset?: string };       // HQ tier assignment; absent = the GM tier plays `program`
  lyrics: { startBar: number; text: string }[];   // the raw Guitar Pro block, up to LYRIC_LINES (5); startBar is 0-based
  bars: Bar[];                   // one per master bar, same order
}
type Clef = 'treble' | 'bass' | 'alto' | 'tenor' | 'percussion';

interface Bar   { id: Id; voices: [Voice, Voice, Voice, Voice]; clef?: Clef }   // always VOICE_COUNT (4); unused voices have no beats; clef: a change from this bar on, absent = the track's
interface Voice { id: Id; beats: Beat[] }

interface Beat {
  id: Id;
  duration: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256;   // denominator; gpif's range, GP5 stops at 64
  dots: 0 | 1 | 2;
  tuplet?: { n: number; of: number };                    // integers >= 1: n in the time of `of`; a triplet is { n: 3, of: 2 }
  rest: boolean;
  notes: Note[];                 // empty with rest false is Guitar Pro's empty beat
  text?: string;
  chord?: { name: string; diagram?: ChordDiagram };     // the name alone is a chord written above the beat
  effects: {
    tremoloPicking?: 8 | 16 | 32; pickStroke?: 'up' | 'down';
    fadeIn?: boolean; fadeOut?: boolean; volumeSwell?: boolean; tapping?: boolean; slapping?: boolean; popping?: boolean;
    arpeggio?: Stroke; brush?: Stroke;
    vibrato?: 'none' | 'slight' | 'wide';
    whammy?: { kind: 'dive' | 'dip' | 'invertedDip' | 'return' | 'releaseUp' | 'releaseDown' | 'hold' | 'custom'; points: BendPoint[] };
  };
  grace?: { duration: 16 | 32 | 64; before: boolean; notes: Note[] }[];   // grace beats carry no id; their notes do
  mix?: {                        // mixer changes kept for fidelity, applied by playback from this beat on
    program?: number;
    volume?: ChannelMixChange; pan?: ChannelMixChange; chorus?: ChannelMixChange;
    reverb?: ChannelMixChange; phaser?: ChannelMixChange; tremolo?: ChannelMixChange;
    tempo?: TempoMark & { duration?: number };   // duration in quarter notes: a linear ramp; absent = a step
  };
  lyrics?: string[];             // one syllable per lyric line, index = line, up to five; '' where a line has none
}
interface Stroke           { direction: 'up' | 'down'; duration?: 4 | 8 | 16 | 32 | 64 | 128 }   // spread of the stroke
interface ChannelMixChange { value: number; duration?: number; allTracks?: boolean }   // value 0..127; duration >= 1 in quarter notes, absent = immediate
interface BendPoint        { position: number; value: number }   // position 0..60 across the note's duration; value in quarter tones; a bend or whammy has at least two

interface ChordDiagram {
  baseFret: number;              // >= 1; first fret shown in the grid; frets stay absolute
  frets: (number | null)[];      // one per string, string 1 first; null = muted, 0 = open
  barres?: { fret: number; firstString: number; lastString: number }[];   // each >= 1
  fingering?: (Finger | null)[]; // parallel to frets
}
type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';

interface Note {
  id: Id;
  string: number;                // 1 = highest-pitched string, as in Guitar Pro; always 0 on drum and pitched tracks
  fret: number;                  // 0..127: fret on fretted tracks; the MIDI note on drum and pitched tracks
  tie: boolean;                  // continues the most recent note on the same string in its voice, at the same fret (see tieOriginOf)
  dead: boolean; ghost: boolean; accent: 'none' | 'accent' | 'heavy'; staccato: boolean;
  bend?: { kind: 'bend' | 'bendRelease' | 'bendReleaseBend' | 'prebend' | 'prebendBend' | 'prebendRelease' | 'release' | 'hold' | 'custom'; points: BendPoint[] };
  slide?: ('shift' | 'legato' | 'intoFromBelow' | 'intoFromAbove' | 'outDown' | 'outUp')[];
  hammerPull: boolean;           // hammered on or pulled off from the previous note on the string; readers move GP5's origin flag here
  vibrato: 'none' | 'slight' | 'wide';
  palmMute: boolean; letRing: boolean;
  harmonic?: { kind: 'natural' | 'artificial' | 'tapped' | 'pinch' | 'semi' | 'feedback'; value?: number };   // value >= 0 is the fret, fractional where needed
  trill?: { fret: number; speed: 16 | 32 | 64 };   // alternate fret, or MIDI note off fretted tracks
  leftHandFinger?: Finger; rightHandFinger?: Finger;
  dynamics: 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';
  accidental?: 'doubleFlat' | 'flat' | 'natural' | 'sharp' | 'doubleSharp';   // the spelling's alteration, not the printed sign; absent = from the key
}

function newId(): Id;
function createEmptyScore(): Score;   // one fretted track in E standard (STANDARD_TUNING), one 4/4 bar at 120 BPM
function createTrack(kind: TrackKind, options?: TrackOptions): Track;   // TrackOptions: any track field but id, kind; plus barCount or bars
// createMasterBar, createBar, createVoice, createBeat, createNote, createScoreMeta: every required field defaulted

function validateScore(score: Score): Violation[];
interface Violation { rule: ViolationRule; path: (string | number)[]; message: string }   // path from the score root
type ViolationRule =
  | 'duplicate-id' | 'first-bar-tempo' | 'bar-count' | 'track-kind' | 'voice-overfull' | 'rest-with-notes'
  | 'string-range' | 'fret-range' | 'duplicate-string' | 'tie-target' | 'tie-pitch' | 'tuplet' | 'dots'
  | 'chord-diagram' | 'alternate-ending-order' | 'alternate-ending-outside-repeat';

const TIE_REACH_BARS = 3;
interface TiePosition { bar: number; voice: number; beat: number }   // indices within one track
interface TieLink { note: Note; bar: number; beat: number }
function tieOriginOf(track: Pick<Track, 'kind' | 'bars'>, at: TiePosition, note: Pick<Note, 'string' | 'fret'>): TieLink | undefined;
function tieChainOf(track: Pick<Track, 'kind' | 'bars'>, at: TiePosition, note: Note): TieLink[];   // the notes tied on from `note`, in score order
```

`validateScore` assumes schema-valid input and checks what the schemas cannot express: unique ids, a tempo mark on the first bar, one bar per master bar, the track-kind constraints, no overfull voice (incomplete bars are allowed), no notes on a rest, string and fret ranges, no two notes on one string, tie targets and tied notes on their origin's fret, the tuplet window (strictly between 1:2 and 2:1, not 1:1), chord diagrams with one fret per string, and voltas unique, ascending and inside a repeat. The table with each rule's exact check is in `packages/model/README.md`.

A tied note's origin (`tieOriginOf`) is the most recent note in its slot (its string; its MIDI note on drum and pitched tracks) in the same voice, searching back from the previous beat to the start of the bar `TIE_REACH_BARS` (three, alphaTab's bound) before its own. Rests and notes on other strings in between are passed over; a note on the same string in between is itself the origin, so it ends the hold. Grace notes are never origins and never tied: `GraceBeat.notes` is `GraceNoteSchema`, which refuses `tie: true`. `tieChainOf` walks the other way, from a note to the tied notes that continue it in score order. `tie-target` fails when there is no origin, `tie-pitch` when the origin is on another fret, and the command layer's tie chains follow the same definition.

### Timing (`@reprise/model`)

```ts
const PPQ = 960;
function beatTicks(beat: Pick<Beat, 'duration' | 'dots' | 'tuplet'>): number;   // never rounded; tuplets can be fractional
function barTicks(masterBar: Pick<MasterBar, 'timeSignature'>): number;          // written length
function playedBarTicks(score, masterBarIndex: number): number;                  // an anacrusis lasts its longest voice
function beatStartTicks(voice: Pick<Voice, 'beats'>, index: number): number;     // index = beats.length gives the voice's end
function barStartTicks(score): number[];                                         // written-order bar starts, masterBars.length + 1 entries
function tickOf(score, position: { bar: number; beat?: number; track?: number; voice?: number }): number;   // written order; RangeError when out of range
// `score` here is Pick<Score, 'masterBars' | 'tracks'>

function expandPlaybackSequence(score: Pick<Score, 'masterBars'>): PlaybackSequence;
interface PlaybackSequence { sequence: BarPass[]; warnings: PlaybackWarning[] }
interface BarPass { masterBarIndex: number; passIndex: number }                 // passIndex counts earlier plays of the bar, from 0
interface PlaybackWarning { code: 'repeat-end-without-start' | 'volta-without-repeat' | 'jump-target-missing' | 'sequence-truncated'; masterBarIndex: number; message: string }
const PLAYBACK_LENGTH_FACTOR = 64;                                               // passes per master bar before the sequence is cut

function tempoMap(score, sequence: readonly BarPass[]): TempoMap;
interface TempoMap { score; passes: TempoMapPass[]; durationSeconds: number }
interface TempoMapPass extends BarPass { startTick: number; ticks: number; startSeconds: number; durationSeconds: number; segments: TempoSegment[] }
interface TempoSegment { tick: number; ticks: number; seconds: number; durationSeconds: number; startBpm: number; endBpm: number }   // offsets from the pass start
const DEFAULT_BPM = 120;
function secondsAt(map: TempoMap, sequenceIndex: number, tick: number): number;   // RangeError outside the map
function secondsAtTick(map: TempoMap, playbackTick: number): number;              // playbackTick = pass startTick + tick; clamped
function positionAtSeconds(map: TempoMap, seconds: number, options?: { track?: number; voice?: number }): PlaybackPosition | undefined;   // clamped; undefined for an empty map
interface PlaybackPosition extends BarPass {
  sequenceIndex: number;
  tick: number;                  // into the pass
  playbackTick: number;          // since playback started, counting every pass
  barProgress: number;           // 0..1
  beatIndex: number | undefined; // the sounding beat of the track and voice asked for; undefined for an empty voice
  beatProgress: number;          // 0..1
}
```

Repeats, voltas and jumps expand by the rules in `../reference/score-model.md` ("Repeats, voltas and jumps"), which follow alphaTab except for the deviations tabulated there; Guitar Pro's own order wins over both when WP-054 compares them. Tempo carries in playback order, and a `Beat.mix.tempo` with a `duration` is a linear ramp in BPM.

### Commands and history (`@reprise/model`)

```ts
interface Command { name: string; run(draft: Score, warn: (warning: CommandWarning) => void): void }   // mutates an Immer draft
interface Change  { command: string; patches: Patch[]; inverse: Patch[]; touchedBars: Id[] }        // touchedBars: master-bar ids layout re-flows
interface Applied { score: Score; change: Change; warnings: CommandWarning[] }
interface CommandWarning { code: 'trill-dropped' | 'natural-harmonic-moved'; noteId: Id; message: string }
function applyCommand(score: Score, command: Command): Applied;
function touchedBars(before: Score, after: Score, patches: readonly Patch[]): Id[];

interface History {
  apply(score: Score, command: Command): Applied;   // score must be the one this history last returned
  undo(): Applied | undefined; redo(): Applied | undefined;   // replay patches; warnings always empty
  beginGroup(label: string): void; endGroup(): void;          // one undo step; nested groups flatten
  readonly canUndo: boolean; readonly canRedo: boolean;
  readonly undoLabel: string | undefined; readonly redoLabel: string | undefined;
  readonly steps: readonly Change[];
}
function createHistory(): History;
class HistoryError extends Error {}
class CommandError extends Error { code: CommandErrorCode; command: string; violations: readonly Violation[] }
type CommandErrorCode =
  | 'not-found' | 'invalid-value' | 'duplicate-id' | 'voice-overfull' | 'string-occupied'
  | 'tie-target' | 'off-fretboard' | 'not-fretted' | 'last-bar' | 'last-track' | 'invariant';

type Changes<T> = { [K in keyof T]?: undefined extends T[K] ? Exclude<T[K], undefined> | null : T[K] };   // null removes an optional field
type NoteInput = Pick<Note, 'string' | 'fret'> & Partial<Omit<Note, 'id' | 'string' | 'fret'>>;
type NoteEffects = Omit<Note, 'id' | 'string' | 'fret'>;
type BeatInput = Partial<Omit<Beat, 'id'>>;
type BeatRhythm = Pick<Beat, 'duration' | 'dots' | 'tuplet'>;
type BeatChanges = { effects?: Changes<BeatEffects> } & Changes<Pick<Beat, 'text' | 'chord' | 'lyrics' | 'mix' | 'grace'>>;
type MasterBarInput = Partial<Omit<MasterBar, 'id'>>;
type MasterBarChanges = Changes<Omit<MasterBar, 'id'>>;
type TrackChanges = Changes<Omit<Track, 'id' | 'kind' | 'bars' | 'channel' | 'display'>> & { channel?: Partial<ChannelSettings>; display?: Changes<DisplaySettings> };
type TrackProperties = Omit<TrackOptions, 'bars' | 'barCount'>;
interface Selection { beatIds?: readonly Id[]; noteIds?: readonly Id[] }   // the notes picked plus every note of the beats picked

setNote({ beatId, id? }, note: NoteInput);                  removeNote({ noteId });
setNoteEffect({ noteId }, Changes<NoteEffects>);            transposeSelection(selection, semitones);
shiftStrings(selection, 'higher' | 'lower');
insertBeat({ voiceId, index, id? }, beat?: BeatInput);      removeBeat({ beatId });
setBeatDuration({ beatId }, Changes<BeatRhythm>);           setBeatRest({ beatId }, rest: boolean);
setBeatEffect({ beatId }, BeatChanges);
insertBar({ index, id? }, masterBar?: MasterBarInput);      removeBar({ masterBarId });
setMasterBar({ masterBarId }, MasterBarChanges);
setTrackProperties({ trackId }, TrackChanges);              addTrack({ kind, index?, id? }, properties?: TrackProperties);
removeTrack({ trackId });                                   moveTrack({ trackId }, index: number);
```

Every command factory returns a `Command`. A command that would break the schema or add a `validateScore` violation throws `CommandError` and nothing is applied; a tie whose origin an edit removes, moves to another pitch or puts out of reach is released instead. Results are frozen by Immer, and the input with them. The per-command behaviour and the `touchedBars` rule are in `../reference/score-model.md` and the header of `packages/model/src/history.ts`.

### Native format (`@reprise/model`)

```ts
// A .reprise file (NATIVE_EXTENSION) is UTF-8 JSON with sorted keys inside app and score, two-space indent, no compression
interface NativeDocument { format: 'reprise'; version: typeof SCORE_VERSION; app: AppInfo; score: Score }   // NativeDocumentSchema
interface AppInfo { name: string; version: string }   // both non-empty; the writer, for diagnostics only
const SCORE_VERSION = 1;                               // the only schema version; Score carries none

function serializeNative(score: Score, app: AppInfo): Uint8Array;   // validates the envelope first; throws NativeFormatError
function parseNative(bytes: Uint8Array): { score: Score; app: AppInfo; warnings: ParseWarning[] };   // throws NativeFormatError
interface ParseWarning { code: ParseWarningCode; path: (string | number)[]; message: string }   // path from the document root
type ParseWarningCode = 'unknown-field' | ViolationRule;
class NativeFormatError extends Error { code: NativeFormatErrorCode; path: (string | number)[] }
type NativeFormatErrorCode =
  | 'invalid-utf8' | 'invalid-json' | 'wrong-format' | 'invalid-version'
  | 'newer-version'                                     // above SCORE_VERSION: "newer than this app"
  | 'migration-failed' | 'invalid-document';            // a step threw; the envelope or score fails NativeDocumentSchema
function formatPath(path: (string | number)[]): string;               // score.tracks[0].bars[2].id

type Migration = (score: unknown) => unknown;          // version n - 1 JSON to version n JSON
type MigrationTable = Readonly<Record<number, Migration>>;
const MIGRATIONS: MigrationTable;                      // keyed by the version a step produces; 1 is the identity
function migrate(score: unknown, fromVersion: number, toVersion?: number, table?: MigrationTable): unknown;
```

### Pitch and spelling (`@reprise/model`)

```ts
function midiNote(track, note: Pick<Note, 'string' | 'fret'>): number;   // tuning[tuning.length - string] + capo + fret; note.fret off fretted tracks
function openStringPitch(track, string: number): number | undefined;
function transpose(track, note: Note, semitones: number): TransposeResult;   // stays on the string; drum notes unchanged
type TransposeResult =
  | { ok: true; note: Note; warnings: ('trill-dropped' | 'natural-harmonic-moved')[] }
  | { ok: false; reason: 'belowOpenString' | 'aboveLastFret' | 'outOfMidiRange'; midi: number; alternatives: { string: number; fret: number }[] };
const MIDI_MAX = 127;

const STANDARD_TUNINGS: readonly { name: string; instrument: 'guitar' | 'bass' | 'ukulele'; strings: readonly number[] }[];   // fourteen, Track.tuning order
function findTuningName(tuning: readonly number[]): string | undefined;

interface Spelling { letter: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'; octave: number; alter: -2 | -1 | 0 | 1 | 2; accidental?: Accidental }   // octave scientific, C4 = 60, B#3 = 60
const LETTERS: readonly Letter[];                      // C D E F G A B
function spell(midi: number, key: KeySignature, accidental?: Accidental): Spelling;
function spellNote(track, note, key: KeySignature): Spelling;
function respell(track, note: Note, key: KeySignature): Note;   // the enharmonic; clears accidental when it is the key's default
function keyAlter(key: Pick<KeySignature, 'fifths'>, letter: Letter): Alter;
function staffPosition(spelling, clef: Exclude<Clef, 'percussion'>, octaveShift?: number): number;   // 0 bottom line, 8 top line

function percussionInstrument(midi: number): PercussionInstrument | undefined;   // GM and GM2, 27..87
interface PercussionInstrument { midi: number; name: string; staffPosition: number; noteHead: 'normal' | 'cross' | 'diamond' | 'triangle' }
const PERCUSSION_INSTRUMENTS: readonly PercussionInstrument[];   // the whole table, by MIDI note
// `track` is a Pick of Track: kind, tuning, capo (and fretCount for transpose)
```

Arguments are track-first wherever a track is needed. Spelling follows Guitar Pro: a stored accidental that can spell the pitch, then the key's notes, then a minor key's raised sixth and seventh, then the natural letter, then a sharp in C major and the sharp keys or a flat in the flat keys. The returned `accidental` is printed against the key signature; cancelling one earlier in the bar is layout's job.

### Test builders (`@reprise/model/testing`)

The one subpath export, importable only from test files (lint boundary `testing-entry-in-tests`):

```ts
function score(): ScoreBuilder;                       // fluent; build(options?: BuildOptions) throws ScoreBuildError on schema or invariant violations
interface BuildOptions { validate?: boolean; ids?: 'random' | 'sequential' }   // sequential: kind-prefixed ids in document order, given ids kept
class ScoreBuildError extends Error { violations: readonly Violation[] }
function note(string: number, fret: number, spec?: NoteSpec): Note;   // NoteSpec = Partial<Omit<Note, 'string' | 'fret'>>
function midi(value: number, spec?: NoteSpec): Note;                  // string 0, fret = the MIDI note
function parseDuration(spec: DurationSpec): Pick<Beat, 'duration' | 'dots' | 'tuplet'>;   // '8' | '4.' | '2..' | '8t'
type Instrument = 'guitar' | 'bass' | 'drums' | 'piano';
type TrackSpec = Omit<TrackOptions, 'bars' | 'barCount'> & { id?: Id };
type BeatSpec = Partial<Omit<Beat, 'duration' | 'dots' | 'notes' | 'rest'>>;
function fullScore(): Score;                                            // every node type and optional field
function largeScore(tracks: number, bars: number, options?: LargeScoreOptions): Score;   // { structure?: boolean }
function beatOf(score: Score, track: number, bar: number, beat: number, voice?: number): Beat;   // throws when absent
function noteOf(score: Score, track: number, bar: number, beat: number, note?: number, voice?: number): Note;
```

Usage is in `../reference/score-model.md`.

### Formats (`@reprise/formats`)

```ts
type Format = 'gp3' | 'gp4' | 'gp5' | 'gp' | 'gpx' | 'reprise';
function detect(bytes: Uint8Array): Format | undefined;
function read(bytes: Uint8Array, format?: Format): Promise<{ score: Score; warnings: Warning[] }>;
function write(score: Score, format: 'reprise' | 'gp', options?: { app?: AppInfo }): Promise<{ bytes: Uint8Array; dropped: Warning[] }>;
```

### Layout (`@reprise/layout`)

```ts
interface LayoutOptions {
  mode: 'paged' | 'continuous'; width: number; pageHeight?: number; zoom: number; tracks: Id[] | 'all'; notation: Record<Id, 'tab'|'standard'|'both'>;
  tiedNotes?: 'parentheses' | 'hidden'; // tied notes on tab staves, parentheses unless given
  margins?: Partial<Margins>;         // page margins, unscaled
  pageGap?: number; staffGap?: number; trackGap?: number; systemGap?: number; // pageGap unscaled, the rest at zoom 1
  dirtyBars?: readonly Id[];          // master bars to re-measure when a cache is given, usually Change.touchedBars
}
interface LayoutResult {
  pages: Page[];                      // continuous mode = one infinitely wide page
  systems: System[];                  // each with its bar range and bounding box
  primitives: Primitive[];            // glyph | line | path | text, with x, y, bbox, theme role
  anchors: Anchor[];                  // model-node id -> bbox, for hit-testing and cursor placement
  metrics: { layoutMs: number; primitives: number; anchors: number; measuredBars: number; reusedSystems: number };
}
interface Anchor {
  kind: 'note' | 'beat' | 'bar' | 'staff' | 'system'; id: Id; bbox: Rect;
  system: number; track?: Id; staff?: 'tab' | 'standard' | 'percussion'; voice?: number; masterBar?: Id;
}
function layout(score: Score, options: LayoutOptions, cache?: LayoutCache): LayoutResult;
function hitTest(result: LayoutResult, x: number, y: number): Anchor | undefined;
```

Layout never touches the DOM. Text widths come from a metrics table generated from the fonts at build time.

### Audio (`@reprise/audio`)

```ts
interface AudioEngine {
  load(score: Score, options: { tier: 'gm' | 'hq'; packs: PackAssignment[] }): Promise<void>; // resolves when the song's instruments are decoded
  play(fromTick?: number): void; pause(): void; stop(): void; seek(tick: number): void;
  setTempo(mode: 'bpm' | 'percent', value: number): void;
  setLoop(range?: { startBar: Id; endBar: Id }): void;
  setCountIn(on: boolean): void; setMetronome(on: boolean, volume: number): void;
  setTrack(id: Id, params: { volume?; pan?; mute?; solo? }): void;
  previewNote(track: Id, note: Note): void;                      // editor feedback
  on(event: 'position' | 'state' | 'loop' | 'memory', handler): Unsubscribe;
  memory(): { decodedBytes: number; budgetBytes: number; residents: InstrumentId[] };
  dispose(): void;
}
```

The scheduler drives an `InstrumentSink` (`noteOn(NoteEvent)`, optional `mix(MixEvent)`, `allNotesOff(when)`, optional `dispose()`), which the sampler implements. The events' fields and timing rules are in `packages/audio/src/sink.ts`, explained in `packages/audio/README.md`, "The `InstrumentSink` contract".

Internals: a lookahead scheduler on the main thread (schedule ~200 ms ahead on a 25 ms timer), a voice pool with per-voice gain and detune automation, region maps produced by the SF2 and SFZ loaders, an LRU cache of decoded buffers under the memory budget, per-track channel strips with an effects chain, a master bus.

### Platform (`apps/web/src/platform`)

```ts
interface Platform {
  openFile(filters): Promise<{ name; bytes; handle? } | undefined>;   // handle: opaque, for writeHandle
  saveFile(suggestedName, bytes, filters): Promise<string | undefined>;
  readFile(path): Promise<Uint8Array>; writeFile(path, bytes): Promise<void>;
  writeHandle(handle, bytes): Promise<void>;   // over an opened file's handle or a path saveFile returned
  libraryDir(): Promise<string>;     // ~/Music/Reprise on desktop; OPFS root in the browser
  dataDir(): Promise<string>;        // Electron userData; OPFS in the browser
  print(): Promise<void>;
  microphone(): Promise<MediaStream>;
}
```

The browser implementation exists so `pnpm dev` works without Electron; the Electron implementation goes through the preload bridge. The packaged renderer is served by main from `reprise://app/`, so the app's own static files (the GM bank, the fonts) load with `fetch` the same way in the browser and in Electron.

## Runtime shape

- **Renderer process**: React, the document store, layout (main thread first, worker-ready), the audio scheduler.
- **Audio thread**: Web Audio's native graph does all mixing. The main thread only schedules.
- **Electron main**: file dialogs, file IO, menus, window state, printing, app paths, and serving the built renderer over `reprise://app`.
- **Threads we may add later**: a layout worker if layout time exceeds its budget; an AudioWorklet scheduler if main-thread jank ever causes gaps. Both are isolated by the contracts above.

## Memory model

- Decoded audio buffers are owned by the audio package's cache. Budget default 300 MB, readable and settable through the engine API and shown in the sound settings.
- A song's `load` computes the instrument set it needs, loads those regions lazily on first use, and evicts least-recently-used instruments when over budget. Switching songs evicts everything the new song doesn't use.
- Layout caches are per bar and dropped when the score is closed.
- The benchmark test opens a long eight-track score and asserts layout time and resident memory stay under the budgets recorded in `plans/roadmap.md`.

## Conventions

- Strict TypeScript, `noUncheckedIndexedAccess` on. No `any`, no `as` casts without a structural reason.
- Source filenames kebab-case. Tests colocated as `*.test.ts`. Comments explain why, not what.
- Every `eslint-disable` carries a justification after `--`.
- Public API of each package is its `index.ts`; nothing else is imported across packages. The one exception is `@reprise/model/testing`, the model's test builders, which test files may import.

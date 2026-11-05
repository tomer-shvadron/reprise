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
  app/            shell, routing, theme, command palette, keyboard map
  platform/       Platform interface + browser and electron implementations
  state/          zustand stores: document, selection, playback, ui
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
- **Layout** is a pure function of the score and view options, cached per bar; a patch marks bars dirty and only those re-flow, then systems re-break from the first dirty bar onward.
- **Audio** reads the score through the tempo map and the playback sequence; it never holds a reference to React state.

## Contracts

The lanes code against these. They are frozen at the end of the model-core phase; changing one is a lead-owned issue.

### Score model (`@reprise/model`)

Implemented in WP-010 as Zod schemas with the types derived from them, node factories,
`newId()` and `validateScore()`; `packages/model/README.md` records the modelling decisions.
WP-011 to WP-014 add timing, commands, the native envelope and pitch helpers to the same
package, and **the contract freezes at WP-015**. The `.reprise` envelope's `version` is the
only version field: `Score.version` is removed in WP-013, when the envelope is defined, and
`SCORE_VERSION` stays exported for it.

Optional fields are exact: absent means "not set", and an explicit `undefined` is rejected.
Ranges below are the schemas' (`1..32` is an inclusive integer range); enumerations are
written out where a lane needs the exact set.

```ts
type Id = string;                // 12 base62 characters from newId(); every node has one except grace beats
type Color = string;             // lower-case #rrggbb

interface Score {
  id: Id;
  version: 1;                    // removed in WP-013; the .reprise envelope carries the version
  meta: { title; subtitle; artist; album; words; music; copyright; tab; instructions; notices: string[] };
  masterBars: MasterBar[];       // at least one; one per bar position, shared by every track
  tracks: Track[];               // at least one
}

interface TempoMark {
  bpm: number;                   // always per quarter note, whatever `unit` displays
  unit?: 'eighth' | 'quarter' | 'dottedQuarter' | 'half' | 'dottedHalf';   // display only; absent = quarter
  label?: string;
}

interface MasterBar {
  id: Id;
  timeSignature: { numerator: 1..32; denominator: 1 | 2 | 4 | 8 | 16 | 32 };
  keySignature: { fifths: -7..7; minor: boolean };    // sharps positive, flats negative
  tempo?: TempoMark;                                   // a change at the start of this bar
  repeat: { start: boolean; endCount: number };        // total plays of the section, 2 = play twice; 0 = no repeat end
  alternateEndings: number[];                          // volta numbers 1..8, ascending
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
  tuning: number[];              // open-string MIDI notes, lowest string first, up to 10; empty on drums.
                                 // A GP5 keyboard track (program outside GM 24..39 and 104..107, channel not
                                 // percussion) is read as pitched and keeps its tuning and fretCount for gp5 export
  capo: number;
  fretCount: number;             // 24 by default; 0 on drums
  program: number; bank: number; // GM program 0..127 and bank 0..16383; on drums, program is the GM2 kit
  channel: { volume; pan; chorus; reverb; phaser; tremolo; mute: boolean; solo: boolean };   // 0..127, pan 64 = centre
  display: { notation: 'tab' | 'standard' | 'both'; clef?: Clef };
  sound?: { packId?: Id; preset?: string };       // HQ tier assignment; absent = the GM tier plays `program`
  lyrics: { startBar: number; text: string }[];   // the raw Guitar Pro block, up to five lines; startBar is 0-based
  bars: Bar[];                   // one per master bar, same order
}
type Clef = 'treble' | 'bass' | 'alto' | 'tenor' | 'percussion';

interface Bar   { id: Id; voices: [Voice, Voice, Voice, Voice]; clef?: Clef }   // always four; unused voices have no beats
interface Voice { id: Id; beats: Beat[] }

interface Beat {
  id: Id;
  duration: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256;   // denominator; gpif's range, GP5 stops at 64
  dots: 0 | 1 | 2;
  tuplet?: { n: number; of: number };                    // n in the time of `of`; a triplet is { n: 3, of: 2 }
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
  grace?: { duration: 16 | 32 | 64; before: boolean; notes: Note[] }[];
  mix?: {                        // mixer changes kept for fidelity, applied by playback from this beat on
    program?: number;
    volume?: ChannelMixChange; pan?: ChannelMixChange; chorus?: ChannelMixChange;
    reverb?: ChannelMixChange; phaser?: ChannelMixChange; tremolo?: ChannelMixChange;
    tempo?: TempoMark & { duration?: number };
  };
  lyrics?: string[];             // one syllable per lyric line, index = line, up to five; '' where a line has none
}
interface Stroke           { direction: 'up' | 'down'; duration?: 4 | 8 | 16 | 32 | 64 | 128 }   // spread of the stroke
interface ChannelMixChange { value: number; duration?: number; allTracks?: boolean }   // value 0..127; duration in beats, absent = immediate
interface BendPoint        { position: number; value: number }   // position 0..60 across the note's duration; value in quarter tones; a bend or whammy has at least two

interface ChordDiagram {
  baseFret: number;              // first fret shown in the grid; frets stay absolute
  frets: (number | null)[];      // one per string, string 1 first; null = muted, 0 = open
  barres?: { fret: number; firstString: number; lastString: number }[];
  fingering?: (Finger | null)[]; // parallel to frets
}
type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';

interface Note {
  id: Id;
  string: number;                // 1 = highest-pitched string, as in Guitar Pro; always 0 on drum and pitched tracks
  fret: number;                  // fret on fretted tracks; the MIDI note on drum and pitched tracks
  tie: boolean; dead: boolean; ghost: boolean; accent: 'none' | 'accent' | 'heavy'; staccato: boolean;
  bend?: { kind: 'bend' | 'bendRelease' | 'bendReleaseBend' | 'prebend' | 'prebendBend' | 'prebendRelease' | 'release' | 'hold' | 'custom'; points: BendPoint[] };
  slide?: ('shift' | 'legato' | 'intoFromBelow' | 'intoFromAbove' | 'outDown' | 'outUp')[];
  hammerPull: boolean;           // hammered on or pulled off from the previous note on the string; readers move GP5's origin flag here
  vibrato: 'none' | 'slight' | 'wide';
  palmMute: boolean; letRing: boolean;
  harmonic?: { kind: 'natural' | 'artificial' | 'tapped' | 'pinch' | 'semi' | 'feedback'; value?: number };   // value is the fret, fractional where needed
  trill?: { fret: number; speed: 16 | 32 | 64 };
  leftHandFinger?: Finger; rightHandFinger?: Finger;
  dynamics: 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';
  accidental?: 'doubleFlat' | 'flat' | 'natural' | 'sharp' | 'doubleSharp';   // explicit spelling; absent = from the key
}
```

`validateScore(score)` returns the cross-node violations the schemas cannot express: unique ids, one bar per master bar, the track-kind constraints, no overfull voice, no notes on a rest, string ranges and no two notes on one string, tie targets, the tuplet window (strictly between 1:2 and 2:1, not 1:1), chord diagrams with one fret per string, and voltas unique, ascending and inside a repeat. The table with each rule's exact check is in `packages/model/README.md`.

Still to come in the same package: tick math at 960 PPQ and bar duration from the time signature (internal today, published by WP-011), `expandPlaybackSequence(score)` returning the ordered list of master-bar indices with repeat and jump semantics and `tempoMap(score, sequence)` mapping ticks to seconds (WP-011), `pitchOf(track, note)` returning a MIDI note with tuning and capo and the spelling helpers for standard notation (WP-014).

### Commands and history (`@reprise/model`)

```ts
interface Command { name: string; run(draft: Score): void }     // Immer draft
interface Change  { command: string; patches: Patch[]; inverse: Patch[]; touchedBars: Id[] }
interface History { apply(score, command): { score; change }; undo(); redo(); beginGroup(label); endGroup() }
```

### Formats (`@reprise/formats`)

```ts
type Format = 'gp3' | 'gp4' | 'gp5' | 'gp' | 'gpx' | 'reprise';
function detect(bytes: Uint8Array): Format | undefined;
function read(bytes: Uint8Array, format?: Format): Promise<{ score: Score; warnings: Warning[] }>;
function write(score: Score, format: 'reprise' | 'gp'): Promise<{ bytes: Uint8Array; dropped: Warning[] }>;
```

### Layout (`@reprise/layout`)

```ts
interface LayoutOptions { mode: 'paged' | 'continuous'; width: number; pageHeight?: number; zoom: number; tracks: Id[] | 'all'; notation: Record<Id, 'tab'|'standard'|'both'> }
interface LayoutResult {
  pages: Page[];                      // continuous mode = one infinitely wide page
  systems: System[];                  // each with its bar range and bounding box
  primitives: Primitive[];            // glyph | line | path | text, with x, y, bbox, theme role
  anchors: Anchor[];                  // model-node id -> bbox, for hit-testing and cursor placement
  metrics: { layoutMs: number; primitives: number };
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

Internals: a lookahead scheduler on the main thread (schedule ~200 ms ahead on a 25 ms timer), a voice pool with per-voice gain and detune automation, region maps produced by the SF2 and SFZ loaders, an LRU cache of decoded buffers under the memory budget, per-track channel strips with an effects chain, a master bus.

### Platform (`apps/web/src/platform`)

```ts
interface Platform {
  openFile(filters): Promise<{ name; bytes } | undefined>;
  saveFile(suggestedName, bytes, filters): Promise<string | undefined>;
  readFile(path): Promise<Uint8Array>; writeFile(path, bytes): Promise<void>;
  libraryDir(): Promise<string>;     // ~/Music/Reprise on desktop; OPFS root in the browser
  dataDir(): Promise<string>;        // Electron userData; OPFS in the browser
  print(): Promise<void>;
  microphone(): Promise<MediaStream>;
}
```

The browser implementation exists so `pnpm dev` works without Electron; the Electron implementation goes through the preload bridge.

## Runtime shape

- **Renderer process**: React, the document store, layout (main thread first, worker-ready), the audio scheduler.
- **Audio thread**: Web Audio's native graph does all mixing. The main thread only schedules.
- **Electron main**: file dialogs, file IO, menus, window state, printing, app paths.
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
- Public API of each package is its `index.ts`; nothing else is imported across packages.

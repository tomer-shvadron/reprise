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
desktop  -> (nothing from packages; talks to web through the preload bridge)
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

```ts
type Id = string; // stable, assigned on creation or import

interface Score {
  id: Id;
  version: number;              // native schema version
  meta: { title; subtitle; artist; album; words; music; copyright; tab; instructions; notices[] };
  masterBars: MasterBar[];      // one per bar position, shared by all tracks
  tracks: Track[];
}

interface MasterBar {
  id: Id;
  timeSignature: { numerator; denominator };
  keySignature: { fifths: number; minor: boolean };
  tempo?: { bpm: number; label?: string };     // tempo change at this bar
  repeat: { start: boolean; endCount: number }; // endCount 0 = no repeat end
  alternateEndings: number[];                   // volta numbers this bar belongs to
  jump?: { kind: 'segno' | 'coda' | 'dsAlCoda' | 'dsAlFine' | 'dcAlCoda' | 'dcAlFine' | 'fine' | 'toCoda' | 'doubleCoda' };
  section?: { name: string; letter?: string };
  tripletFeel?: 'none' | 'eighth' | 'sixteenth';
  doubleBar: boolean;
}

interface Track {
  id: Id;
  name: string; shortName: string; color: string;
  kind: 'fretted' | 'drums' | 'pitched';
  tuning: number[];             // MIDI note per string, low to high; empty for drums/pitched
  capo: number;
  program: number; bank: number; // GM program and bank
  channel: { volume; pan; chorus; reverb; phaser; tremolo };
  display: { notation: 'tab' | 'standard' | 'both'; clef?: 'treble' | 'bass' };
  sound?: { packId?: Id; preset?: string };    // HQ override, absent = GM tier
  bars: Bar[];                  // same length as masterBars
}

interface Bar   { id: Id; voices: [Voice, Voice, Voice, Voice]; clef?: 'treble' | 'bass' }
interface Voice { id: Id; beats: Beat[] }

interface Beat {
  id: Id;
  duration: 1 | 2 | 4 | 8 | 16 | 32 | 64;
  dots: 0 | 1 | 2;
  tuplet?: { n: number; of: number };
  rest: boolean;
  notes: Note[];
  text?: string; chordName?: string; chordDiagram?: ChordDiagram;
  effects: { tremoloPicking?: 8|16|32; pickStroke?: 'up'|'down'; fadeIn?: boolean; tapping?: boolean; slapping?: boolean; popping?: boolean; arpeggio?: 'up'|'down'; brush?: 'up'|'down'; vibrato?: boolean; wideVibrato?: boolean };
  grace?: { notes: Note[]; duration: 16|32|64; before: boolean };
  mix?: { volume?; pan?; tempo?; ... };        // mixer changes stored for fidelity
  lyrics?: string[];                             // one per lyric line
}

interface Note {
  id: Id;
  string: number;               // 1 = highest-pitched string, as in Guitar Pro
  fret: number;                 // or MIDI note for pitched/drums
  tie: boolean; dead: boolean; ghost: boolean; accent: 'none' | 'accent' | 'heavy'; staccato: boolean;
  bend?: { kind: 'bend' | 'bendRelease' | 'bendReleaseBend' | 'prebend' | 'prebendRelease'; points: { position: number; value: number }[] };
  slide?: ('shift' | 'legato' | 'intoFromBelow' | 'intoFromAbove' | 'outDown' | 'outUp')[];
  hammerPull: boolean;          // this note is hammered/pulled from the previous
  vibrato: 'none' | 'slight' | 'wide';
  palmMute: boolean; letRing: boolean;
  harmonic?: { kind: 'natural' | 'artificial' | 'tapped' | 'pinch' | 'semi'; value?: number };
  trill?: { fret: number; speed: 16|32|64 };
  leftHandFinger?: number; rightHandFinger?: number;
  dynamics: 'ppp'|'pp'|'p'|'mp'|'mf'|'f'|'ff'|'fff';
}
```

Plus pure helpers: tick math at 960 PPQ, bar duration from time signature, tuplet scaling, `expandPlaybackSequence(score)` returning the ordered list of master-bar indices with repeat and jump semantics, `tempoMap(score, sequence)` mapping ticks to seconds, `pitchOf(track, note)` returning a MIDI note with tuning and capo, and spelling helpers for standard notation.

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

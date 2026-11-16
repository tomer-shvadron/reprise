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
    audio/        the audio service: the sound bank fetch and the adapter from the engine to the playback store
  platform/       Platform interface + browser and electron implementations
  state/          zustand stores: document, selection, playback, layout (derived), ui, practice, editing
  features/
    score/        SVG painter, cursor overlay, selection rendering, print view     (score lane)
    transport/    transport bar, tempo, loop, count-in, metronome controls         (lead)
    tracks/       track sidebar, mixer                                             (lead)
    library/      library screen, import, save/export flows                        (formats lane)
    trainer/      speed trainer, tuner, standalone metronome, practice log, fretboard (app lane)
    editor/       note entry, palettes, dialogs, clipboard, undo UI                 (score lane)
    sounds/       sound pack manager                                               (audio lane)
```

A lane owns its feature folder the same way it owns its package. Each folder's README states its owner lane and the work packages that fill it:

| Folder              | Lane (checkpoint)        | Work packages                                | Stub entry point (WP-056)                                          |
| ------------------- | ------------------------ | -------------------------------------------- | ------------------------------------------------------------------ |
| `features/library`  | formats (Library)        | WP-060, WP-061, WP-073 (schema migration)    | `LibraryScreen`, `library.show`                                    |
| `features/trainer`  | app (Trainer)            | WP-070, WP-071, WP-072, WP-073, WP-074       | `TrainerPanel`, `trainer.speedTrainer`, `.tuner`, `.metronome`, `.fretboard` |
| `features/editor`   | score (Editor)           | WP-080 to WP-086                             | `editor.toggleMode`                                                |
| `features/sounds`   | audio (HQ sound)         | WP-091, WP-094                               | `SoundManager`, `sounds.show`                                      |

The shell wires them, not the lanes (roadmap lane rule 5): `ui.screen` (`'player' | 'library' | 'sounds'`) shows the library and the sound manager over the score, and `ui.rightPanelView` (`'mixer' | 'speedTrainer' | 'tuner' | 'metronome' | 'effects' | 'history'`) picks the right panel's content and `ui.bottomPanel` (`{ open, view: 'fretboard' }`) the bottom region's. Each feature's commands are registered in `app/app-registry.ts` from its `commands.ts`, so the palette lists them. A lane replaces its stub in its own folder; the wiring in `app.tsx` is already there. A feature may import another feature's pure exports through that feature's `index.ts` (the speed trainer reads `TEMPO_PERCENT`, `bpmFor` and `loopBarNumbers` from `features/transport`), never its internals or its stores.

### Shared state for phase 3

Added by the lead in WP-056 so that no phase 3 lane edits `state/` for its first work package:

- `document.songId` (`Id | undefined`): the library song the open document was opened from or imported as. `openBytes(name, bytes, { handle?, songId? })` sets it, `setSongId` sets it after an import, `close` and the next open clear it. Not undoable, never marks the document modified. For WP-060, WP-061 and WP-073.
- `practice` (`state/practice.ts`): the running `PracticeSession` (`songId`, `documentId`, `startedAt`, `playedMs`, `loops` as bar ids with the best completed speed-trainer step in percent, `tempoHistory` against played time) and the actions `start`, `addPlayed`, `noteLoop`, `recordTempo`, `recordStep`, `end`, `setSongId`. `start` for another document replaces the running session and returns it, so WP-073 can store it; `recordStep(range, percent)` takes the loop from `playback.settings.loop`; `loops` is ordered by last use so the last one is what "resume" restores; `setSongId` attributes a session to a song imported mid-session. For WP-070 and WP-073.
- `editing` (`state/editing.ts`): the edit-mode flag, reset to play mode at every document open. The edit cursor and range selection of WP-080 live in the selection store, below.
- `ui.screen`, `ui.rightPanelView` and `ui.setScreen`, `ui.showPanelView`, `ui.toggleMixer`: described above. "Toggle mixer" (F8 and the footer button) closes the right panel only when it shows the mixer, and otherwise shows the mixer. A screen makes the player inert, takes focus and closes on Escape.

### Selection and edit cursor

`state/selection.ts` is plain data plus atomic setters; the behaviour that needs the model (navigation, keeping the cursor valid after an edit, undo or redo, moving between tracks) lives in `features/editor` as pure functions.

- `selection` (the model's `Selection`), `currentTrack`, `bars` and `barsAnchor` as before.
- `cursor: EditCursor | undefined`: `track`, `masterBar`, `voice` (`Bar.voices` index), `beat` (an id; undefined is the empty slot after the voice's last beat), `string` (1 = highest, 0 without strings), `staff` (`StaffType`, where the cursor is drawn in `both`) and `at` (`{ track, bar, beat }`, the indices it last resolved to: `track` into `score.tracks`, `bar` into `score.masterBars`, `beat` into the voice's stops, the end slot being the last stop, `beats.length`; the fallback when an edit removes its beat, bar or track). Ids, so an edit leaves it on the same beat.
- `range: EditRange | undefined`: `kind` (`'beats'` or `'bars'`), `anchor` and `focus` as `RangeEnd` (`track`, `masterBar`, `beat`; an undefined `beat` takes the whole bar). A `beats` range covers every voice.
- `setEdit(patch)` sets the keys present in `patch` (`cursor`, `range`, `selection`, `bars`, `barsAnchor`, `currentTrack`) in one update; a key present as undefined clears it. The editor keeps the invariants: `cursor.track === currentTrack`, and `bars` and `barsAnchor` mirror `range`'s master-bar span.
- `reset()` clears the cursor and range; `selectBars()` clears the range, so a bar selection in play mode never leaves a stale beat range.

Shortcut contexts: `Command.context?: 'editing'` limits a shortcut to edit mode. A key may be bound once without a context and once per context. The dispatcher runs the matching command whose context is active (`CommandRegistry.isActive`, which the app registry answers from `state/editing.ts`), and otherwise the context-free one, so transport keeps the arrows when not editing. Between several active contexts the earlier one in `COMMAND_CONTEXTS` wins. The command palette lists a command only when it has no context or its context is active, and shows no shortcut on a context-free command that an active context's command shadows, so it shows the key that would fire. The shortcut table shows the context.

### Phase 3 contract review (2026-11-15)

Every `type:contract` issue raised in phase 2 is closed and recorded in the Contracts section above: #61 (layered regions, filter, envelope delay and choke groups, shipped as #79), #62 (tie origins and faster ids), #87 (the harmonic sounding-pitch helper moves to the model), #101 (continuous-mode segments rendered relative to their start) and #118 (beats past the end of an over-full bar are played). None is open. The model, formats and layout contracts need no change for a lane's first work package. Five things phase 3 needs are not covered by any contract yet; each has a `type:contract` issue, and the work package that needs it waits for it:

- **Platform directory operations ([#202](https://github.com/tomer-shvadron/reprise/issues/202); WP-060 import, WP-061, WP-073, WP-090, WP-091).** `Platform` has `openFile` (one file), `saveFile`, `readFile`, `writeFile`, `writeHandle`, `libraryDir`, `dataDir`, `print` and `microphone`, and no directory operations: creating a directory, listing one, moving a file (the `trash/` folder, originals), deleting, and picking a folder or several files for batch import. The sound pack manager needs listing, deleting and a download target. This changes `apps/web/src/platform` and the preload bridge, not the model.
- **An edit cursor in the selection state ([#203](https://github.com/tomer-shvadron/reprise/issues/203); WP-080, first deliverable). Resolved by #203:** the selection store has `cursor` and `range`, and the command registry has shortcut contexts (see "Selection and edit cursor" above). The model's `Selection` still holds only `beatIds` and `noteIds`.
- **Previewing a single note through the audio service ([#204](https://github.com/tomer-shvadron/reprise/issues/204); WP-081). Resolved by #204:** `AudioService.previewNote(trackId, { string, fret } | { pitch }, { velocity?, duration? })`, working stopped or playing (see "Changed by #204").
- **A metronome with no song open ([#205](https://github.com/tomer-shvadron/reprise/issues/205); WP-072, first deliverable). Resolved by #205:** the engine has a standalone click and the service `startClick`, `updateClick` and `stopClick` (see "Changed by #205").
- **A bottom panel region ([#206](https://github.com/tomer-shvadron/reprise/issues/206); WP-074). Resolved by #206:** the app frame has a collapsible bottom region above the transport (see "Changed by #206").

Dependencies: `apps/web` has `dexie` and, for tests, `fake-indexeddb` (ADR-0012), added by the lead in WP-056 so WP-060 does not edit `package.json` or the lockfile.

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
- **Mixer**: volume, pan and instrument are score edits through `setTrackProperties`; mute and solo are the engine's per-song overrides (`setTrack`), mirrored in the playback store; visibility and single-track view are the document's view state, and notation per track is view state that Save writes into the file (ADR-0024). A timeline-neutral edit reaches the sampler without rebuilding the sequence, inside `AudioEngine.load`.

## Contracts

**Frozen on 2026-11-05 at WP-015.** Changes after this date are `type:contract` issues owned by the lead.

Changed by #62 (2026-11-05): a tie's origin is the most recent note on its string in its voice within three bars, not only the previous beat (`tieOriginOf`, `TIE_REACH_BARS`); `newId()` draws its random bytes from a pooled buffer, with the same format and distribution. Widened by #65 (2026-11-05): `tieChainOf`, the forward walk in score order, is exported; a grace note may not carry `tie` (`GraceNoteSchema`); `ChannelMixChange.duration` counts quarter notes, the unit the #66 review ruled; and the audio sink contract (`packages/audio/README.md`) gains `InstrumentSink.mix?(MixEvent)` for beat-level mixer changes, replayed at each run start, and `NoteEvent.continuations`, the tied links folded into an onset.

Changed by #82 (2026-11-06): `write` takes an optional third argument, `write(score, format, options?: { app?: AppInfo })`, the app stamped into a `.reprise` file, defaulting to `{ name: 'reprise', version: '0.0.0' }`.

Changed by #79 (2026-11-06): a region map resolves every layered region of a key and velocity (`RegionMap.resolveAll`) and a note starts one voice per region behind one handle; `Region` gains `filter` (a static low-pass at the filter envelope's held level, its resonance lowering the DC gain by half its peak) and `exclusiveClass` (choke groups within a track's instrument), `Envelope` gains `delay`; the voice pool stays a hard cap and ranks stealing victims by their audible level, articulation gain included, taking a voice that starts with or after the new note only when no other is left; `Sampler.setInstrument` takes an optional time, `Sampler.instrumentAt(trackId, when)` returns the instrument a note at `when` plays, and `Sampler.allNotesOff` drops the instrument changes scheduled after its time; the sampler sink switches a track's instrument from `InstrumentSink.mix` (`MixEvent.mix.program`) through its `instrumentOf` option.

Changed by #169 (2026-11-15): `Region` gains `modulators` (SF2 note-on modulators the voice evaluates once per note: velocity and key sources on attenuation, the cutoff, the filter envelope's depth and Q; with them the velocity curve is theirs, without it is (v/127)^2) and `filter.envelope` (a modulation envelope the voice plays over time: delay, attack, hold, decay to a sustain share of `cents`; release not modelled). `filter.cutoffHz` now means the cutoff at rest, not the envelope's held level, and `attenuation` from an SF2 is the 0.4-scaled raw sum, left unclamped for the voice to add the modulators and clip to 0..144 dB. `PresetReport.modulated` counts zones with an unapplied modulator, and `modEnvToFilterFc` leaves `unsupported`. See ADR-0027.

Changed by #194 (2026-11-15): `Region` gains optional SFZ fields, none of which an SF2 region sets: `loop.unit: 'frames'` (the voice divides by the buffer's own sample rate, since an SFZ loader cannot know a file's rate before reading it), `startFrame` (SFZ `offset`), `oneShot` (a note-off is ignored; `allNotesOff` still stops it), `velocityTrack` (`velocityGain(v) ** velocityTrack` on the path without modulators), `group` and `offBy` (a new note of a group chokes the voices whose `offBy` equals it, one-way; an SF2 `exclusiveClass` c reads as `group = offBy = c`), `trigger` (`release`, `first`, `legato`; release regions are kept and not played until WP-093), `sequence` and `random`. `RegionMap.resolveAll` gains an optional `select` argument (`sequence`, `random`, `legato` counters) and filters by those fields before matching, defaulting to position 1, the bucket holding 0 and no legato; `RegionMap.candidates` returns every region a note could start across all round-robin and random positions, and `planSamples` and `Sampler.preload` use it. On an SF2 map `candidates` equals `resolveAll`, and no SF2 behavior changes.

Changed by #202 (2026-11-15): `Platform` gains `openFiles`, `openFolder`, `mkdir`, `listDir`, `move` and `remove`, and, on desktop only, `setRecentSongs?` and `onOpenRecent?`; see the Platform section for the paths, the folder limits and the browser's storage. `RepriseBridge` gains the same names, over new `file:open-many`, `folder:open`, `storage:*` and `menu:set-recent` channels and a `menu:open-recent` event.

Changed by #96 (2026-11-06): `OpenedFile` (and the `file:open` result) gains an optional opaque `handle`, the picked path in Electron and the `FileSystemFileHandle` in a browser with the File System Access API, and `Platform` gains `writeHandle(handle, bytes)`, which writes over that file or over a path `saveFile` returned; Save writes a `.reprise` in place through it, and a `.gp` with the gp writer once the user confirms what it loses; gp3, gp4, gp5 and gpx have no writer of their own, so Save sends them to Save As, which asks for Reprise or Guitar Pro 7–8 before the platform dialog.

Changed by #87 (2026-11-07), widening the model and narrowing audio: `soundingPitch(track, note)`, the pitch a note sounds at as a fractional MIDI note, moves from `@reprise/audio` (where it was `soundingKey`) to the model's root export, so layout can place a harmonic where it sounds; its results are unchanged. `@reprise/audio` no longer exports `soundingKey` or `harmonicInterval`. The Note sketch's `harmonic.value` comment states the convention #92 documented: the node's fret for a natural harmonic, the offset above the fretted note for every other kind.

Changed by #109 (2026-11-07): in paged mode a system taller than the page's content area is split between its staves (between tracks where it can, never through a staff) into parts on consecutive pages, each starting at a page top; `LayoutResult.systems` lists each part as a `System` on one page, consecutive parts sharing `bars`; `System.part` (0, 1, …) marks the parts of a split system, and a part after the first has the id `system:<first master-bar id>/<part>`; a master bar's column anchor (`bar` without `track`) and the `system` anchor are repeated in every part, each covering that part's staves, and `metrics.reusedSystems` counts parts.

Changed by #112 (2026-11-07): `createAudioEngine({ context, budgetBytes?, scheduleMemory?, scheduler?, frames?, lookahead?, startLatency? })` owns the `AudioContext` (a factory is called on the first `unlock`, `play` or `previewNote`), the GM bank (`setSoundfont`), the sampler, the memory manager, the metronome on the master bus and the master level; `setTrack`, `previewNote(track, { string, fret })`, `memory()` and the `memory` event work as sketched. `load` resolves `{ instruments }`, the song plan's, once the opening bars are decoded; over a loaded song it keeps the position, clamped to the new score, and the transport state by the rule `seek` uses, and applies a timeline-neutral edit without rebuilding; loading the same score again decodes it again; `unload({ evict? })` ends a song. New: `unlock`, `setSoundfont`, `unload`, `setMasterVolume`, `previewTrack`, `outputLatency`, `settled` and the `instrumentLoads` event. What `createAudioEngine({ sink })` was is now `createTransport`. `InstrumentSink.allNotesOff(when)` also cancels the mixer changes scheduled after `when`, and `Sampler.allNotesOff` the strips' volume and pan. A preset that only shares a song's samples is resident only when a song plays it, and an eviction is counted only when it frees a buffer (#99).

Changed by #113 (2026-11-07): `LayoutOptions.headerHeight` keeps room at the top of the first page for a header the caller draws. That page's smaller room splits a system taller than it, as #85 splits a system taller than a page. `Platform.print` takes an optional `{ pageSize: 'A4' | 'Letter' }`, which the Electron implementation passes to `webContents.print` so the system dialog opens on the chosen paper; the browser relies on the print's `@page` size.

Changed by #118 (2026-11-07): `playedBarTicks` lasts an over-full bar (a voice longer than its time signature, which only an imported file holds) as long as its longest voice in any track, as it already did for an anacrusis that holds less, so every written beat plays in order and the bars after it start later; the tempo map, the scheduler, the cursor and `tickOf` / `barStartTicks` follow it. `voice-overfull` stays an invariant: readers report it as a warning and commands still refuse to create one. Since #123 the gp writer keeps a tempo or sound change on such a bar's overflow beats in that bar, at a `Position` of 1 or more, and the gpif reader reads it back there, capping a non-finite `Position` at the bar's length.

Changed by #125 (2026-11-07): the model's root export gains `canShowTab(track)`, true only for a fretted track with strings, and `shownNotation(track, wanted)`, the notation a track is drawn in: `wanted` on fretted tracks with strings and on drums, `standard` otherwise. Layout gives a pitched track a standard staff whatever its `display.notation` or a `LayoutOptions.notation` override asks for, and the app saves it as standard.

Changed by #101 (2026-11-08): in continuous mode each system is drawn as if it began the line at the left margin, and the new `System.offsetX` is how far right it sits: its primitives (path data included) and its anchors' boxes are in that frame, so layout-space x is x + `offsetX`. `System.bbox`, `System.staves` and `Page.bbox` stay in layout space, and paged systems have no `offsetX` and are unchanged. `hitTest` still takes layout-space coordinates and returns the stored anchor; the new `anchorBox(result, anchor)` gives an anchor's box in layout space. A cached re-layout after an edit that changes a bar's width and keeps the segment breaks reuses every later segment at its new offset instead of re-rendering it.

Changed by #205 (2026-11-15): a metronome with no song. Before it, `engine.play` threw with no score and the service's `play` returned, and the metronome was only the song transport's per-beat click, so nothing clicked with no document open. The engine gains `startClick(settings?)`, `updateClick(settings)`, `stopClick()`, `click()` (`{ running, settings }`) and the `click` event (a boolean: running), over `ClickSettings { bpm (10 to 600), beatsPerBar (1 to 32), accents (a boolean per beat of the bar, `[true]` for the downbeat), subdivision (1 to 4 clicks per beat), volume (0 to 1) }`; `bpm` counts the beat the app picks from the time signature (quarters in x/4, the dotted quarter with `subdivision: 3` in 6/8, eighths for odd meters); the engine has no note value and WP-072's time-signature control owns the mapping. `createStandaloneClick`, `DEFAULT_CLICK_SETTINGS`, `CLICK_BPM_RANGE`, `CLICK_MAX_BEATS` and `checkClickSettings` are exported too. It runs on the transport's lookahead clock through its own `ClickSynth` on the master bus (so the master volume scales it); a new `bpm` re-times the next click from the last one sent, and `beatsPerBar`, `accents` and `subdivision` apply from the next beat (a new `beatsPerBar` takes the bar in progress), so a change never glitches. `MetronomeSink.click(when, accent, subdivision?)` takes an optional third argument for a softer click between beats, which `RecordingSink` records. The rule: the song and the click are exclusive. `play` stops a running click, and `startClick` pauses a playing song (it keeps its position). `AudioService` gains `startClick(settings?: Partial<ClickSettings>)`, `updateClick(partial)` and `stopClick()`, which merge into and mirror `playback.click` (`{ running, settings }`); `startClick` unlocks the context, so call it from a gesture; it validates first (a `RangeError` makes no context) and reports an unavailable output as `output.status: 'error'` instead of throwing. The service's `play` still needs a loaded song.

Changed by #206 (2026-11-16): a bottom panel region. The app frame gains a collapsible `section`, labelled by its view ("Fretboard"), between the score row and the transport, with its own `bottom` slot filled by `app.tsx`. It has a header row (the view's title and a collapse button with a tooltip) above a body that scrolls on its own, and collapsing returns focus to what had it before the region opened, or to the score. The score row has a floor (`min-h-40`) and the region shrinks below its stored height before the transport is clipped. It hosts one view at a time (`BottomPanelView`, `'fretboard'` first). `ui` gains `bottomPanel: { open, view }`, `bottomPanelHeight` (px, `BOTTOM_PANEL_HEIGHT` min 120, default 200, max 480, clamped) and the actions `showBottomPanelView(view)`, `toggleBottomPanelView(view)` (closes when that view is already showing), `setBottomPanelOpen(open)` and `setBottomPanelHeight(height)`; only the height persists, in `localStorage` under `reprise.bottomPanelHeight` (`state/bottom-panel-storage.ts`, every access in try/catch), written by `persistBottomPanelHeight` when a resize ends, the open state starts closed. The resize handle is `ResizeHandle` with `axis="y"`: `role="separator"`, `aria-orientation="horizontal"`, ArrowUp and ArrowDown (up grows), and the "Collapse bottom panel" button closes the region; `ResizeHandle`'s `onResizeEnd` fires on pointer up and after a key press. `fretboard` is no longer a right-panel view: `PanelView` loses it, `trainer.fretboard` is now "Toggle fretboard" and calls `toggleBottomPanelView('fretboard')`, and `TrainerView` is the union of both regions' views. The score pane needs no layout change: `ScoreView` reads its client size through a `ResizeObserver`, so virtualization sees the new height. Follow does not react to a size change by itself, so opening, closing or resizing the region calls `requestFollow()` when `follow.on` (a hand scroll's pause stands). WP-074 replaces the `fretboard` stub in `TrainerPanel`; it reads position through `startPositionReader` and may be wider or taller than the region, whose body (not the header) has `overflow-auto`.

Changed by #245 (2026-11-16): the document store's save contract (`state/document.ts`). `beginSave(): SaveMark | undefined` captures the document, the undo depth, the notation and the view-folded `score` a save writes, and sets `saving` (undefined with nothing open or while a save runs); `finishSave(mark, outcome): boolean` always clears `saving` and, only while the mark's document is still open, commits `savedDepth`, `savedNotation`, `file` and `savedKeys` for `{ saved: { name, format, handle, savedKey }, songId? }` (a present `songId` key sets or clears it), sets `error` for `{ failed, fileName }`, and changes nothing for `{ cancelled: true }`; an edit made during the save keeps the document dirty. The built-in `save()` and `saveAs()` are built on them. `setSaver(saver | undefined)` installs a `Saver { save(builtin), saveAs(builtin) }` that `save()` and `saveAs()` go through, receiving the built-in to delegate to (the library installs its rules this way; the default is the built-in). The built-in `saveAs()` writes `.reprise` only: `SavePrompt` is now only `overwrite`, and `SaveAnswer` is `'cancel' | 'overwrite'`; `.gp` moves to Export (WP-061). `openBytes` takes `{ modified: true }` and `newDocument(score, { modified: true })`, which leave `savedDepth` at -1 so a recovered draft opens unsaved. The built-in `save()` treats a string handle under `library/` with no `songId` (a deleted song) as no handle and goes to Save As.

Changed by #224 (2026-11-16): the model's root export gains `chain(name, steps)` and `setMasterBars(edits)` (with the types `ChainStep` and `MasterBarEdit`). `chain` is a command whose steps (a command, or a function of the score so far) each run on the score the previous step produced, atomic, one history step, one change set that merges the steps' own patches as a group does; `Command` gains the optional `compose` hook `applyCommand` uses for it; it exists because every locator searches the score from before a recipe, so two commands cannot share one draft (`insertBeat` then `setNote` on the new beat threw `not-found`, `removeBar` twice removed the wrong bar). `setMasterBars` validates several master-bar edits once against the end state, so a valid range edit is not refused partway.

Changed by #204 (2026-11-15, amended 2026-11-16): a single-note preview. The engine's `previewNote(track, note, options?)` takes `note` as `PreviewNote`, `{ string, fret }` (resolved through the track's tuning and capo, as playback does) or `{ pitch }` (a MIDI key, no string), and `options` as `PreviewOptions`, `{ velocity?, seconds? }` (the sampler's preview velocity 96 and length 0.6 s by default); both types are exported from `@reprise/audio` and used unchanged by the service. Preview voices are tagged: a preview chokes only a preview, on the same string, or on the same key for a `{ pitch }` note, and the song's voices never choke a preview nor a preview a song voice. A sample not yet decoded no longer makes the preview silent: its decode is requested and the note starts when the sample is resident, with its length cut by the wait, and dropped when that takes over 500 ms (late feedback is worse than none). At most one preview waits per track and string (per key for a pitch): a newer one replaces it, and a stop (`allNotesOff`), `removeTrack`, `addTrack` and `dispose` cancel it. `AudioService.previewNote(trackId, note, options?)` is the same pair. Contract: it throws a `RangeError`, before unlocking or touching the engine, for a track the open song lacks, for a string outside a fretted track's tuning (1 to the string count), for a fret that is not an integer from 0 to 127, and for a non-finite velocity, seconds or pitch. A finite velocity (1 to 127, rounded), seconds (0.05 to 5) or pitch (0 to 127, rounded) outside its range is clamped, because unlike a string or fret it names no place that does not exist. It returns without sounding, and without an error, with no document, while the document loads, when the output failed, and in the window where the document is ahead of the engine's song (a rebuild queued by `defer`) for a track the engine lacks. It works stopped or playing, through the track's strip (program, bank, volume, pan), past mute and solo, and unlocks the context, so call it from a gesture. Callers call it last in a handler, since it can throw. The fake audio service in `apps/web/src/test/services.ts` has `previewNote: vi.fn()`.

Changed by #225 (2026-11-16): the document store gains `newDocument(score)`, which opens a never-saved document around a score the caller built (`createEmptyScore()`): a new `id`, fresh history, `file` and `songId` undefined, the view and warnings reset, not modified, `revision + 1`; it drops an open still reading and settles a pending save prompt, and Save on it falls through to Save As. `MenuCommandId` gains `'file.new'`, and the desktop File menu gains New Song on `CmdOrCtrl+N` at the top; the web registry routes `file.new` (`Mod+N`) to a placeholder that opens an untitled empty score, which WP-083 replaces with the unsaved-changes prompt and edit mode. The library releases the held bytes of an unimported file whenever the document id changes, and its "Not in your library" banner hides for a document with no file.

Changed by #246 (2026-11-16): `MenuCommandId` gains `'file.export'`, and the desktop File menu gains Export as Guitar Pro… under Save As, with no accelerator yet; the web registry routes it to a placeholder (hidden from the palette) until WP-061 PR 1. `Platform` gains, on desktop only, `setDocumentEdited?(edited)`, `onCloseRequest?(listener)` and `confirmClose?(close)`, and `RepriseBridge` the same over the invoke channels `window:set-edited` `[edited: boolean]` and `window:close` `[close: boolean]` and the event `window:close-requested`. Main keeps a close guard per window (`close-guard.ts`, pure and unit tested): while the renderer has reported `edited: true` it holds a window close, and Quit through `before-quit`, and sends `window:close-requested`; the renderer answers `window:close`: `true` closes the window (and quits the app, if the request was Quit), `false` cancels and ends the request, and an answer with no request open is ignored. A crash or hang never finishes an open request; it only lets the next close or Quit through unasked. The guard lets a close through without asking when the renderer process is gone, reported unresponsive by Electron, or the window is already being destroyed, and a committed navigation (`did-navigate`) resets it, the macOS dot and the crashed and unresponsive flags. Each close or Quit attempt asks again, so the listener treats a request while its dialog is open as a no-op. Preload reports `edited` to main only while an `onCloseRequest` listener is subscribed, so a renderer with nobody to answer never holds the window open. `setDocumentEdited` also sets the macOS edited dot. The renderer never registers `beforeunload` on desktop, because Electron cancels such a close silently. Preload checks the boolean before invoking, main validates it again, and no new path crosses the bridge, so `PathAccess` is unchanged. `writeFile` and a string `writeHandle` to a root-relative path are atomic on desktop: the bytes go to a hidden temp file in the same folder (`.name.<hex>.tmp`, never listed), are fsynced, and replace the target in one `rename` (retried briefly on Windows for `EPERM`, `EACCES` and `EBUSY`), which survives a process kill but is not a power-loss guarantee (no directory fsync, no `F_FULLFSYNC`) and resets mode and extended attributes; the temp file is removed on any error, leftovers older than a minute are swept at startup, and a picked or saved absolute path is still written in place. `REPRISE_PROFILE_DIR`, an absolute folder read by main from its own environment, moves `userData` and the library inside it, and main logs a line to stderr when it is active; `pnpm desktop:smoke` runs under a temporary one and deletes it, so it no longer imports into `~/Music/Reprise`.
Changed by #254 (2026-11-16): `@reprise/model` gains `setNoteEffects(edits)` and `setBeatEffects(edits)`, with the types `NoteEffectEdit` (`{ noteId, effects: Changes<NoteEffects> }`) and `BeatEffectEdit` (`{ beatId, changes: BeatChanges }`), the batched forms of `setNoteEffect` and `setBeatEffect`. Each does one id-index pass and applies every edit on one draft, so a range edit costs the notes touched rather than a score scan per note (a 400-note `setNoteEffects` on `largeScore(8, 300)` measures about 5 ms, against 0.75 to 0.95 s for a `chain` of single commands); the result is validated once (each touched track once for beats) and is one history step, atomic, with `touchedBars` the union of the edited bars. An empty list or an id named twice is refused as `invalid-value`, an unknown id as `not-found`. `setNoteEffects` also reaches grace notes by id, checked against `GraceNoteSchema`. In `apps/web`, `PanelView` gains `'effects'` and `'history'`; `app.tsx` renders a placeholder for each (WP-082 and WP-084) in its right-panel switch until WP-082 PR B and WP-084 PR 2 replace them, and `TrainerView` excludes both. A batch checks every new grace-note id across all its edits in one walk (`assertFreshIds`, in `commands/checks.ts`), refusing a repeat as `duplicate-id` like the chain; a refused edit names its note or beat.

Changed by #266 (2026-11-16): ranged reads and a desktop download, for the sound pack manager (WP-091). `PickedFile.read(range?)` and `Platform.readFile(path, range?)` take `{ offset, length }` (type `ReadRange`): non-negative safe integers, `length` at most `MAX_READ_LENGTH` (16 MiB, enough for the zip reader's 4 MiB chunks); a range past the end returns the bytes that exist (empty when it starts at or past the end). `file:read` takes the optional range as a second argument; `validate.ts` checks it, main reads at that position with `fs.read` (so a root-relative path keeps its symlink checks and an absolute one its read grant), the browser uses `File.slice` for a picked file and `getFile().slice` for OPFS and throws a `RangeError` on a bad range, and `fakePlatform()`'s store does the same. `Platform` gains, on desktop only, `download?({ url, to, sha256, maxBytes, onProgress?, signal? })` resolving `{ size }`, over the invoke channels `download:start [id, url, to, sha256, maxBytes]` and `download:cancel [id]` and the event `download:progress [id, loaded, total?]`; `RepriseBridge` gains `startDownload`, `cancelDownload` and `onDownloadProgress`, and the Electron platform owns the id (a `crypto.randomUUID()` per call), filters progress to it and maps an aborted `signal` to `cancelDownload` and an `AbortError`. The browser has no `download` (undefined), so the Sounds screen offers "Open download page" and the zip drop there. Main enforces: `https:` only for the URL and for every redirect (redirects are followed by hand, at most five, each re-checked, none to a URL with credentials), no host allowlist (the curated list lives in the web app and the pinned SHA-256 guards integrity); `to` a root-relative file path under `data/sounds/` with the storage-path rules (`validate.ts`); `maxBytes` a positive integer clamped to `MAX_DOWNLOAD_BYTES` (2 GiB), with the Content-Length checked against it before any byte is read and the running count checked as the body streams; the body streams to a hidden `.<name>.<12 hex>.part` beside `to`, hashed as it goes, fsynced and renamed into place (retried briefly on Windows, like `writeFile`) only when the SHA-256 matches, and deleted on a mismatch, a cancel, an oversize body or any error, leaving an existing `to` untouched; progress is throttled to one event per 100 ms plus a last one; one download per id (a second under an id in use is refused) and at most four at once; a download ends when its window is destroyed or navigates. The startup sweep that removes stale `.tmp` files also removes `.part` files older than a minute, and listings hide them. The state machine (`download-machine.ts`) and the redirect loop (`download-http.ts`) are pure and tested with fake streams; only the one-hop network call (`electron-http.ts`, Electron's `net` with `redirect: 'manual'`) is not. `fakePlatform()` has no `download` by default, like the browser; `fakeDownload(storage, { bytes, progress, fail })` in `apps/web/src/test/services.ts` is a scripted one a test passes in.

Changed by #260 (2026-11-16): history labels for the undo UI (WP-084). `@reprise/model`'s `History` gains `undoLabels` and `redoLabels`, every command name on each stack newest first (a group or chain under its own name; strings only, no patches). The document store gains `historyLabels: { undo: readonly string[]; redo: readonly string[] }`, the same object while neither list changed, and `lastStep: 'apply' | 'undo' | 'redo' | undefined`, set by `apply` (only when it changed something), `undo` and `redo` and reset by an open, `newDocument` and `close`. The platform gains the optional `setHistoryLabels?({ undo?, redo? })` over a new `menu:set-history` channel (type `HistoryMenuLabels`, an absent entry meaning an empty stack); `validate.ts` cleans each label like a title and cuts it at 100 characters, and main rebuilds the whole menu template, so every other item keeps its state and accelerator. Undo and Redo are never disabled (a disabled item stops the accelerator reaching a modal text field on macOS): they read "Undo <label>" / "Redo <label>", and plain "Undo" / "Redo" when the stack is empty or before the renderer first reports. Labels are newest first (the WP-084 plan's K2 says oldest first and K4 caps at 80; this contract supersedes both: newest first, capped at 100 by `validate.ts`). `installHistoryMenu(document, platform, display?)` maps each command name to its menu text, the identity by default, and the app wires it. The web side (`state/history-menu.ts`) pushes the newest labels only when one changes, and nothing on the web build.

Changed by #259 (2026-11-16): `@reprise/model` gains `replaceBeats(edits)` and the type `BeatSpliceEdit` (`{ voiceId, index, remove, beats: readonly Beat[] }`), a batched splice of voices' beats for paste and cut: one `chain` of `insertBar` steps plus one `replaceBeats`, where the single `removeBeat`/`insertBeat` steps each walked the whole score. It does one voice-index pass (`indexVoices`), one `assertFreshIds` over every new beat, note and grace note across the edits (`duplicate-id`), validates each touched track once (an over-full voice is refused `invariant`), releases ties in a second pass after every voice is spliced, once per voice from its first splice's index, so the result does not depend on the order of the edits (a note whose origin a splice removed loses its tie, and so does an orphan tie on a pasted beat, unlike `insertBeat`, which refuses it, because a pasted clip often starts with a tied note), and is one history step, atomic, with `touchedBars` the union. Several edits on one voice are indexed against the voice as it was and applied back to front. An empty list, edits on one voice that overlap or share an index, and an index or count out of range are refused as `invalid-value`, an unknown voice as `not-found`. A 4-bar by 8-track paste on `largeScore(8, 300)` measures about 37 ms, against about 2.5 s for the equivalent `chain` of `removeBeat` and `insertBeat` steps.

Changed by #267 (2026-11-16), the pack assignment contract of WP-091. Model: `Track.sound.instrument?: string`, a key into the pack's instruments (absent means the pack's first), round-tripped by the native format and dropped by the gp writer under the same `sound-override` warning as `packId`. Audio: `PackAssignment` is `{ trackId, pack: { id, files: SfzFiles }, entries }`, where `entries` maps articulation-set keys to SFZ paths in the pack and `default` is required; `LoadOptions.tier` selects the memory budget (`budgetBytes`, 80 MiB, for `gm`; the new `AudioEngineOptions.hqBudgetBytes`, 300 MiB, for `hq`); `LoadResult` gains `fallbacks: { trackId, packId, error }[]`, the assigned tracks whose pack failed to load and play GM; loading the same score again with different `packs` checks only the tracks whose assignment changed. `timelineNeutral` also compares `sound.instrument`. The root exports `tierOf(track, packs)` (hq when an assignment names the track, the one rule the engine and the web share), `checkPack`, `checkSfzFile` and the types `PackSnapshot`, `SnapshotFile`, `SfzFileCheck` and `LoadFallback`; `@reprise/audio/testing` exports `encodeWav`, `encodeFlac` and `syntheticSfzPack()`. The provider routing that plays a pack's samples is WP-091's engine PR: until it lands, a loaded assignment changes the track's tier but not its sound. Web: `playback.trackSounds` (`{ tier, packId?, problem?: 'missing' | 'failed', message? }` per track), `AudioServiceOptions.packs?: PackDirectory` and `hqBudgetBytes`, `AudioService.releasePack(id)`, `AppServices.sounds` (`createSoundPackStore({ platform })`, the minimal `PackDirectory` store the pack manager fills), and the drop zone leaves drops alone while `ui.screen` is `'sounds'`.

Changed by #285 (2026-11-16), the region selection and release triggers of WP-093 (`packages/audio`; no change to the model, the `AudioEngine` interface, `LoadResult` or the `PackAssignment` type). `Region` gains `releaseDecay` (SFZ `rt_decay`, dB per second held, release regions only) and release regions now play: `RegionMap.resolveRelease(key, velocity, layer?, select?)` returns the release regions a note-off starts, matching key and velocity exactly (the layer fallback stays, the nearest-region fallback does not: a note-off with no matching release region is silent), `RegionMap.hasReleaseRegions` lets a map without any skip the call, and `candidates` includes the release regions a note-off can trigger so a preload makes them resident. `NoteOnRequest` gains `select` (the `RegionSelection` the note's regions and its release regions are chosen by); `VoiceHandle.release` and the let-ring release start the note's release regions, once, as one-shot voices outside the string choke and inside the polyphony, and a choke, a steal, `allNotesOff` and a preview never start them: a choke or steal at `t` also cancels the note's tails that have not started by `t`. A release voice never steals (skipped and counted in `Sampler.skippedReleases` when the pool is full at its start) and is the first a later note steals. `SamplerSinkOptions` gains `voicingOf?(track)` (a `Voicing`: per-set instrument or layer, and `legatoTrigger`), and the sink fills `select`: a per-key sequence counter reset by `allNotesOff`, a random draw hashed from the note id, the pass and the strike, and `legato` on a hammer-on when the voicing has a legato trigger; with no voicing, as on every General MIDI track, playback is unchanged. The root exports `ARTICULATION_SETS`, `ArticulationSet`, `articulationSetOf` and `Voicing`, and the keys of `PackAssignment.entries` are documented as those sets, unknown keys ignored. `@reprise/audio/testing` gains `syntheticGuitarPack()`. `InstrumentUse.layers` and a `planSamples` that walks only the planned layers are documented in the audio README and land with the planner PR.

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
  sound?: { packId?: Id; instrument?: string; preset?: string };       // the sound choice: optional HQ packId, optional instrument (a key into the pack's instruments, absent = its first; only meaningful with packId), optional effects preset; with no packId the GM tier plays `program`; preset is an effects-preset id, opaque to the model, valid without packId, unknown = automatic (#234)
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
  harmonic?: { kind: 'natural' | 'artificial' | 'tapped' | 'pinch' | 'semi' | 'feedback'; value?: number };   // value >= 0, fractional where needed: the node's fret (natural), else the node's offset above the fretted note
  trill?: { fret: number; speed: 16 | 32 | 64 };   // alternate fret, or MIDI note off fretted tracks
  leftHandFinger?: Finger; rightHandFinger?: Finger;
  dynamics: 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';
  accidental?: 'doubleFlat' | 'flat' | 'natural' | 'sharp' | 'doubleSharp';   // the spelling's alteration, not the printed sign; absent = from the key
}

function newId(): Id;
function createEmptyScore(): Score;   // one fretted track in E standard (STANDARD_TUNING), one 4/4 bar at 120 BPM
function createTrack(kind: TrackKind, options?: TrackOptions): Track;   // TrackOptions: any track field but id, kind; plus barCount or bars
function canShowTab(track: Pick<Track, 'kind' | 'tuning'>): boolean;   // fretted with strings only; a pitched track's notes are MIDI pitches on string 0
function shownNotation(track: Pick<Track, 'kind' | 'tuning'>, wanted: 'tab' | 'standard' | 'both'): 'tab' | 'standard' | 'both';   // wanted on fretted tracks with strings and on drums, else 'standard'
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
function playedBarTicks(score, masterBarIndex: number): number;                  // an anacrusis or an over-full bar lasts its longest voice
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
interface Command {
  name: string;
  run(draft: Score, warn: (warning: CommandWarning) => void): void;                // mutates an Immer draft
  compose?(score: Score, step: (command: Command) => Score): void;                  // composite commands (chain): applyCommand calls this instead of run; step applies a command to the score so far, throws once compose has returned
}
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
setBeatEffect({ beatId }, BeatChanges);                     setNoteEffects(edits: { noteId, effects: Changes<NoteEffects> }[]);
setBeatEffects(edits: { beatId, changes: BeatChanges }[]);
replaceBeats(edits: { voiceId, index, remove, beats: Beat[] }[]);
insertBar({ index, id? }, masterBar?: MasterBarInput);      removeBar({ masterBarId });
setMasterBar({ masterBarId }, MasterBarChanges);            setMasterBars(edits: { masterBarId, changes: MasterBarChanges }[]);
chain(name: string, steps: (Command | ((score: Score) => Command))[]);
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
function soundingPitch(track, note: Pick<Note, 'string' | 'fret' | 'harmonic'>): number;   // fractional MIDI; a harmonic on a fretted track sounds its node's pure overtone
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

A subpath export importable only from test files (lint boundary `testing-entry-in-tests`), as is `@reprise/audio/testing`, whose `debugAudioEngine(engine)` reaches an engine's live objects (#112):

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
  mode: 'paged' | 'continuous'; width: number; pageHeight?: number; zoom: number; tracks: Id[] | 'all'; notation: Record<Id, 'tab'|'standard'|'both'>; // notation overrides display.notation; drums always get a percussion staff, a track that cannot show tab a standard one
  tiedNotes?: 'parentheses' | 'hidden'; // tied notes on tab staves, parentheses unless given
  margins?: Partial<Margins>;         // page margins, unscaled
  headerHeight?: number;              // paged: room kept free at the top of the first page for a header the caller draws, unscaled; less than the page's content area, else RangeError
  pageGap?: number; staffGap?: number; trackGap?: number; systemGap?: number; // pageGap unscaled, the rest at zoom 1
  dirtyBars?: readonly Id[];          // master bars to re-measure when a cache is given, usually Change.touchedBars
}
interface LayoutResult {
  pages: Page[];                      // continuous mode = one infinitely wide page
  systems: System[];                  // each with its bar range and bounding box (continuous: and `offsetX`, how far right of the left margin its frame sits), on one page; a system taller than the page is split into parts
  primitives: Primitive[];            // glyph | line | path | text, with x, y, bbox, theme role; continuous: in their system's frame
  anchors: Anchor[];                  // model-node id -> bbox, for hit-testing and cursor placement; continuous: in their system's frame
  metrics: { layoutMs: number; primitives: number; anchors: number; measuredBars: number; reusedSystems: number };
}
interface Anchor {
  kind: 'note' | 'beat' | 'bar' | 'staff' | 'system'; id: Id; bbox: Rect;
  system: number; track?: Id; staff?: 'tab' | 'standard' | 'percussion'; voice?: number; masterBar?: Id;
}
function layout(score: Score, options: LayoutOptions, cache?: LayoutCache): LayoutResult;
function hitTest(result: LayoutResult, x: number, y: number): Anchor | undefined;
function anchorBox(result: LayoutResult, anchor: Anchor): Rect; // an anchor's box in layout space
```

Layout never touches the DOM. Text widths come from a metrics table generated from the fonts at build time.

### Audio (`@reprise/audio`)

```ts
interface AudioEngine {
  load(score: Score, options: { tier: 'gm' | 'hq'; packs: PackAssignment[] }): Promise<{ instruments: InstrumentId[]; fallbacks: { trackId: Id; packId: string; error: string }[] }>; // once the opening bars are decoded; over a loaded song, an edit that keeps the position
  play(fromTick?: number): void; pause(): void; stop(): void; seek(tick: number): void;
  setTempo(mode: 'bpm' | 'percent', value: number): void;
  setLoop(range?: { startBar: Id; endBar: Id }): void;
  setCountIn(on: boolean): void; setMetronome(on: boolean, volume: number): void;
  setTrack(id: Id, params: { volume?; pan?; mute?; solo? }): void;
  previewNote(track: Id, note: Pick<Note, 'string' | 'fret'> | { pitch: number }, options?: { velocity?: number; seconds?: number }): void; // editor feedback
  on(event: 'position' | 'state' | 'loop' | 'memory' | 'instrumentLoads', handler): Unsubscribe;
  memory(): { decodedBytes: number; budgetBytes: number; residents: InstrumentId[] };
  dispose(): void;
  unlock(): void;                                                // makes the context from a factory, resumes it
  setSoundfont(font: Sf2Soundfont): void;                        // the GM bank, fetched by the app
  unload(options?: { evict?: boolean }): void;                   // ends the song
  setMasterVolume(volume: number): void;
  setGmTierBypass(on: boolean): void;                            // default on: only the automatic preset is skipped on GM-tier tracks, a known sound.preset still applies (#234)
  setStageBypass(trackId: Id, stage: EffectStage, bypassed: boolean): void;   // a session override like setTrack: not saved, kept through edits, cleared by unload (#234)
  previewTrack(id: Id, params: { volume?; pan? }): void;         // a slider being dragged, no override
  outputLatency(): number;
  settled(): Promise<void>;
}
```

The scheduler drives an `InstrumentSink` (`noteOn(NoteEvent)`, optional `mix(MixEvent)`, `allNotesOff(when)`, optional `dispose()`), which the sampler implements. The events' fields and timing rules are in `packages/audio/src/sink.ts`, explained in `packages/audio/README.md`, "The `InstrumentSink` contract".

Changed by #234 (2026-11-16): `AudioEngine` gains `setGmTierBypass(on)` (default on) and `setStageBypass(trackId, stage, bypassed)`, and `@reprise/audio` exports the pure `resolveEffects`, `presetFamilyOf`, `EFFECT_PRESETS` and `EFFECT_PRESET_IDS`, and the types `EffectPresetId`, `EffectStage`, `EffectFamily`, `ResolvedEffects` and `ResolveContext`. `Track.sound.preset` is an effects-preset id, opaque to the model, valid without `packId`; an unknown id means automatic. A `sound` change that touches only `preset` is timeline-neutral (ADR-0024). The web app's `AudioService` passes `setGmTierBypass` through and keeps it in `settings.gmTierBypass`, persisted with the transport preferences.

Internals: a lookahead scheduler on the main thread (schedule ~200 ms ahead on a 25 ms timer), a voice pool with per-voice gain and detune automation, region maps produced by the SF2 and SFZ loaders, an LRU cache of decoded buffers under the memory budget, per-track channel strips with an effects chain, a master bus.

### Platform (`apps/web/src/platform`)

```ts
interface Platform {
  openFile(filters): Promise<{ name; bytes; handle? } | undefined>;   // handle: opaque, for writeHandle
  saveFile(suggestedName, bytes, filters): Promise<string | undefined>;
  readFile(path, range?: { offset; length }): Promise<Uint8Array>; writeFile(path, bytes): Promise<void>;   // range: #266
  writeHandle(handle, bytes): Promise<void>;   // over an opened file's handle or a path saveFile returned
  libraryDir(): Promise<string>;     // ~/Music/Reprise on desktop; OPFS root in the browser
  dataDir(): Promise<string>;        // Electron userData; OPFS in the browser
  print(options?: { pageSize: 'A4' | 'Letter' }): Promise<void>;   // Electron opens the system dialog on that paper
  microphone(): Promise<MediaStream>;

  // Added by #202: several files, a folder, and file operations inside the app's own roots.
  openFiles(filters): Promise<PickedFile[]>;               // [] on cancel
  openFolder(filters): Promise<PickedFolder | undefined>;  // undefined on cancel
  mkdir(path): Promise<void>;                              // recursive, idempotent
  listDir(path): Promise<{ name; kind: 'file' | 'directory' }[]>;   // sorted; [] when absent
  move(from, to): Promise<void>;                           // makes to's parent; rejects when `to` exists
  remove(path): Promise<void>;                             // a file or a tree; absent is fine
  setRecentSongs?(items: { id; title }[]): void;           // desktop only: File > Open Recent, at most 10
  onOpenRecent?(listener: (id: string) => void): () => void;   // desktop only
  download?({ url, to, sha256, maxBytes, onProgress?, signal? }): Promise<{ size }>;   // desktop only (#266): https, to under data/sounds/, SHA-256 checked before the rename
}

interface PickedFile { name; relativePath; size; read(range?: { offset; length }): Promise<Uint8Array> }   // bytes read on demand
interface PickedFolder { name; files: PickedFile[]; truncated: boolean }
```

**File operations and their paths.** Paths in the app's own roots are root-relative, with the root named by the first segment: `library/songs/a.reprise` is under `libraryDir()`, `data/trash` under `dataDir()`. That spelling is canonical, and what a library row stores. `mkdir`, `listDir`, `move`, `remove`, `readFile`, `writeFile` and a string `writeHandle` take it; `libraryDir()` and `dataDir()` are for display (Show in Finder, settings). An absolute path means a file the user picked or saved through a dialog and nothing else: main grants nothing under the roots by absolute path, and the browser reads no `/library/...` either, so the root-relative route, with its name and symlink checks, is the only way into a root. An absolute path that is a UNC or device path (`\\host\share`, `\\?\`, `//host`) is refused before any resolution, so main never opens a network connection from a renderer-supplied path. A path is plain text with `/` separators; an absolute path, a drive letter, a backslash, an empty, `.` or `..` segment, a first segment other than `library` or `data` and any name Windows tools cannot open (a trailing dot or space, `CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, `COM1`-`COM9`, `LPT1`-`LPT9` and their superscript forms, with or without an extension, `<>"|?*:` and control characters) are rejected on every platform, as is a path through a symlink, so no call can leave its root. `move` and `remove` refuse a root itself; `writeFile` makes the folders above its path, on every platform. On desktop the Electron main process does the checking and the work (`storage:*` channels and the storage paths of `file:read` and `file:write`; `storage-path.ts` for the text and `storage-fs.ts` for the disk, with `rename` falling back to a copy that never overwrites and removes its partial target on failure); the `data` root is `userData/files`, not `userData`, which is Chromium's profile. The renderer never sees a real path for these calls, and preload exposes only the named calls. Picked files are granted to the renderer read-only: `file:read` takes them, `file:write` refuses them, and only files the user opened or saved in a dialog can be written back. The browser stores both roots as top-level directories of origin-private storage, `FileSystemHandle.move` where the engine has it and a copy (checked against a target that appeared meanwhile) where not, and asks `navigator.storage.persist()` once, on first use. File systems differ on case: a case-only `move` (`library/a` to `library/A`) is refused as "already exists" on the case-insensitive defaults of macOS and Windows and succeeds in OPFS and the test double.

**Pickers.** `openFiles` and `openFolder` use the native dialog on desktop (main grants each picked path, and a `PickedFile` reads through a read-only grant) and, in a browser, `showOpenFilePicker({ multiple: true })` and `showDirectoryPicker()` where they exist, else an `<input type=file multiple>` and an `<input type=file webkitdirectory>`. A folder walk is recursive, filtered by the filters' extensions (case-insensitive), in name order, skips dot entries and symlinks, and stops at `PICKED_FOLDER_LIMITS`: 10 000 files, 16 levels of directories and 100 000 entries visited (matching or not, so a pick of a home folder ends in bounded time). `PickedFolder.truncated` is true when it stopped at any of them, so a caller can say the folder held more; `PickedFolder.skipped` counts folders below the picked one that could not be read (permissions) and were left out, where the picked folder itself being unreadable rejects. `PickedFile.relativePath` is `/`-separated and inside the picked folder (equal to `name` for a file picked alone). A directory input cannot tell an empty folder from a cancel, so `openFolder` resolves undefined for both there.

**The recent list.** `setRecentSongs` hands the File menu the titles to show under Open Recent (main keeps ten, strips control and bidi characters from a title and cuts it at 200, falling back to `Untitled`, and refuses an id over 128); a pick is sent back as `menu:open-recent` and reaches `onOpenRecent`'s listener with the id. The browser has neither member, so a caller tests for them.

**The test double.** `fakePlatform()` in `apps/web/src/test/services.ts` runs the file operations, `readFile`, `writeFile`, a path `writeHandle`, `libraryDir` and `dataDir` over an in-memory store (`createMemoryStorage()` in `apps/web/src/test/memory-storage.ts`, which a test can create itself to inspect `paths()` and `bytes()`) with the contract's path rules (parents made on write, `listDir` on a file rejects), and its pickers cancel; a test overrides a picker to hand back files.

The browser implementation exists so `pnpm dev` works without Electron; the Electron implementation goes through the preload bridge. The packaged renderer is served by main from `reprise://app/`, so the app's own static files (the GM bank, the fonts) load with `fetch` the same way in the browser and in Electron.

## Runtime shape

- **Renderer process**: React, the document store, layout (main thread first, worker-ready), the audio scheduler.
- **Audio thread**: Web Audio's native graph does all mixing. The main thread only schedules.
- **Electron main**: file dialogs, file IO, menus, window state, printing, app paths, and serving the built renderer over `reprise://app`.
- **Threads we may add later**: a layout worker if layout time exceeds its budget; an AudioWorklet scheduler if main-thread jank ever causes gaps. Both are isolated by the contracts above.

## Memory model

- Decoded audio buffers are owned by the audio package's cache. The budget follows the tier of the last `load` (#267): 80 MiB on the GM tier (`budgetBytes`) and 300 MiB on the HQ tier (`hqBudgetBytes`), until WP-094 makes it a setting readable and settable through the engine API and shown in the sound settings.
- A song's `load` computes the instrument set it needs, loads those regions lazily on first use, and evicts least-recently-used instruments when over budget. Switching songs evicts everything the new song doesn't use.
- Layout caches are per bar and dropped when the score is closed.
- The benchmark test opens a long eight-track score and asserts layout time and resident memory stay under the budgets recorded in `plans/roadmap.md`.

## Conventions

- Strict TypeScript, `noUncheckedIndexedAccess` on. No `any`, no `as` casts without a structural reason.
- Source filenames kebab-case. Tests colocated as `*.test.ts`. Comments explain why, not what.
- Every `eslint-disable` carries a justification after `--`.
- Public API of each package is its `index.ts`; nothing else is imported across packages. The exceptions are `@reprise/model/testing`, the model's test builders, and `@reprise/audio/testing`, the audio engine's diagnostics, which only test files may import.

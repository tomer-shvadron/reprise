# Phase 3: Four lanes to full feature

Parallel. Four lanes run at once; each checkpoint is integrated by the lead when its lane finishes, in whatever order they finish. Expected order by scope: library, trainer, editor, HQ sound. Exit condition: all four checkpoints as defined in `roadmap.md`.

Lane ownership in this phase:

| Lane          | Package           | Feature folder                     | Checkpoint |
| ------------- | ----------------- | ---------------------------------- | ---------- |
| `[P:formats]` | `packages/formats` | `apps/web/src/features/library`   | Library    |
| `[P:app]`     | none              | `apps/web/src/features/trainer`    | Trainer    |
| `[P:score]`   | `packages/layout`  | `apps/web/src/features/editor`    | Editor     |
| `[P:audio]`   | `packages/audio`   | `apps/web/src/features/sounds`    | HQ sound   |

---

# Formats lane → Library checkpoint

## WP-060: Library and import

- **Size**: L · **Blocked by**: WP-056
- **Packages**: `apps/web/src/features/library`

**Deliverables**

- Dexie database `reprise` with tables: `songs` (id, title, artist, album, source format, native path, original path, imported at, last opened, duration in bars, track summary, per-song settings such as mixer state and notation modes: `TrackSession` from `apps/web/src/features/tracks/session.ts`; volume, pan, instrument and notation live in the score), `practiceSessions` (added by WP-073 via a migration owned by this lane's schema file), `settings` (key-value).
- Import flow: a file dropped or opened is parsed, saved as native into `libraryDir()/songs/<id>.reprise`, the original copied to `libraryDir()/originals/`, and indexed. Batch import of a folder.
- Library screen: list with title, artist, album, format badge, last opened; search as you type; sort by title, artist, last opened, imported; open on enter or double-click; delete with confirmation (moves files to a `trash/` folder rather than deleting); recent list in the File menu and on the empty state.
- Open-without-import: a file opened with a modifier or from the palette's "Open without importing" shows with a banner offering to import.

**Acceptance criteria**

- Import of fifty fixtures and local tabs completes with a progress indicator and no UI freeze; search returns within a frame.
- Reopening a song restores its per-song settings.

## WP-061: Save, export and autosave

- **Size**: M · **Blocked by**: WP-060
- **Packages**: `apps/web/src/features/library`, `apps/web/src/state`

**Deliverables**

- Save (native, to the library path or the opened path), Save As (native, anywhere), Export (gp, with a dialog listing what will be dropped from `formats.write`'s `dropped` list, and a checkbox to not warn again per song).
- Dirty tracking from the history; a close-with-unsaved-changes prompt; the window title shows the dirty marker.
- Autosave: every change debounced to a draft at `dataDir()/drafts/<song-id>.reprise`; on launch, drafts newer than their songs offer recovery; a successful save deletes the draft.

**Acceptance criteria**

- Killing the process mid-edit and relaunching offers the draft with the last edit present.
- Exported gp opens in alphaTab in a test with the expected content.

---

# App lane → Trainer checkpoint

## WP-070: Speed trainer

- **Size**: M · **Blocked by**: WP-056
- **Packages**: `apps/web/src/features/trainer`

**Deliverables**

- A panel bound to the current loop range: start tempo (percent or BPM), increment, repetitions per step, target tempo; a run state that listens to the engine's `loop` event to count repetitions and steps the tempo; a progress display of current tempo and repetitions; pause and reset.
- Shortcuts and palette entries; the panel docks in the right panel region.

**Acceptance criteria**

- RTL tests with a mocked engine for the stepping logic; an e2e that runs two steps on a fixture.

## WP-071: Tuner

- **Size**: M · **Blocked by**: WP-056
- **Packages**: `apps/web/src/features/trainer`

**Deliverables**

- Mic capture through `platform().microphone()`; pitch detection with the McLeod pitch method or YIN on a 2048-sample window at the context's sample rate, with a confidence threshold; smoothing over a few frames.
- Display: detected note name and octave, a cents meter from -50 to +50, and the target string highlighted from the current track's tuning and capo, with the nearest string chosen automatically and overridable by clicking a string.
- Reference pitch setting (default 440).

**Acceptance criteria**

- A test feeds synthesized tones at known frequencies, including slightly detuned ones, and asserts the cents readout within two cents; the e2e opens the tuner panel and asserts the mic permission flow in Electron.

## WP-072: Standalone metronome

- **Size**: S · **Blocked by**: WP-056
- **Packages**: `apps/web/src/features/trainer`

**Deliverables**

- A metronome panel usable with no song open: BPM with tap tempo, time signature, downbeat accent, subdivision (quarter, eighth, triplet, sixteenth), volume, start and stop; uses the engine's metronome path with no score loaded.

**Acceptance criteria**

- Offline test of click timing at three tempos; works from the empty state of the app.

## WP-073: Practice log

- **Size**: M · **Blocked by**: WP-060, WP-070
- **Packages**: `apps/web/src/features/trainer`, `apps/web/src/features/library` (schema migration only)

**Deliverables**

- Session capture: a session starts on first play of a song and ends on close or after inactivity; it records total played time, loop ranges with their bar IDs, and for each loop the highest tempo at which the speed trainer completed a full step; stored in `practiceSessions`.
- A song page in the library: total time, sessions over time as a simple list, the loops worked on with their best tempos, and a "resume" that restores the last loop and tempo.

**Acceptance criteria**

- A session persists across restarts; bar IDs survive an edit that inserts bars before the loop.

## WP-074: Live fretboard

- **Size**: S · **Blocked by**: WP-056
- **Packages**: `apps/web/src/features/trainer`

**Deliverables**

- A fretboard component for the current track: string count and tuning from the track, 24 frets, capo shown; notes of the beat at the playback position highlighted with their names; in edit mode later, the selected beat's notes.
- Docks in the bottom panel region, collapsible; left-handed flip setting.

**Acceptance criteria**

- Follows playback on a fixture without dropping frames; RTL test for note placement across tunings.

---

# Score lane → Editor checkpoint

## WP-080: Hit-testing and selection model

- **Size**: M · **Blocked by**: WP-056
- **Packages**: `packages/layout`, `apps/web/src/features/editor`

**Deliverables**

- `hitTest` covering every anchor kind with priority (note over beat over bar over staff); an edit cursor model in the selection store: track, bar, voice, beat, string; range selection of beats and bars across tracks; keyboard movement of the cursor with arrows, home and end, and page keys; mouse placement by click.
- The painter's selection and cursor overlays extended for edit mode: a string-position cursor, range highlight.

**Acceptance criteria**

- Clicking any note in the long fixture selects it; arrow navigation covers every beat without skipping.

## WP-081: Note entry

- **Size**: L · **Blocked by**: WP-080
- **Packages**: `apps/web/src/features/editor`

**Deliverables**

- Edit mode toggle; digit keys set the fret at the cursor with two-digit entry on a short timeout; delete removes the note; duration keys change the beat's duration; keys for dot, tie, tuplet, rest; enter inserts a beat after the cursor; the cursor advances after entry per Guitar Pro behaviour; voice switch between voices one and two.
- Each entry runs a model command through the history and calls `previewNote` so it sounds.
- An insert-versus-overwrite setting; a status line showing the current duration and voice.

**Acceptance criteria**

- A sixteen-bar riff can be entered from the keyboard only in an e2e test and matches an expected score; every entry is one undo step.

## WP-082: Effects palette

- **Size**: M · **Blocked by**: WP-081
- **Packages**: `apps/web/src/features/editor`

**Deliverables**

- A palette panel and shortcuts to toggle every note and beat effect in scope on the selection, with bend presets (quarter, half, full, with and without release, prebend) generating the model's bend points; harmonics kind picker; slide kind picker; vibrato kind; dynamics.
- Effects apply to a range selection in one grouped command.

**Acceptance criteria**

- Every effect in `scope-v1.md` can be applied and removed, renders, and sounds.

## WP-083: Bar and track management

- **Size**: M · **Blocked by**: WP-080
- **Packages**: `apps/web/src/features/editor`

**Deliverables**

- Insert bar before or after, delete bars, master bar dialog (time signature, key signature, tempo mark, repeat start and end count, alternate endings, jump kind, section name) applied to one bar or a range.
- Track dialog: name, short name, color, kind, string count and tuning from the standard tunings table or custom, capo, GM program; add, remove, reorder tracks from the sidebar.
- New song from the palette and the File menu using `createEmptyScore`.

**Acceptance criteria**

- A song with a time-signature change, a repeat with two endings and a D.S. al Coda can be built from the UI and plays correctly.

## WP-084: Clipboard and undo UI

- **Size**: M · **Blocked by**: WP-081
- **Packages**: `apps/web/src/features/editor`

**Deliverables**

- Copy, cut and paste of a beat range or a bar range within a track and across tracks of compatible kind (fretted to fretted re-fingers by pitch where string counts differ, with a warning); paste as insert or overwrite; an internal clipboard plus a text representation on the system clipboard for pasting between app instances.
- Undo and redo menu items and shortcuts with the command name shown; a history panel listing changes.

**Acceptance criteria**

- Cross-track paste of four bars is one undo step; the history panel reflects grouped edits.

## WP-085: Chord names, lyrics and transposition

- **Size**: S · **Blocked by**: WP-081
- **Packages**: `apps/web/src/features/editor`

**Deliverables**

- Inline editing of the chord name above a beat and of the lyric line under it, with tab moving to the next beat; transpose selection by semitones and shift selection up or down a string via commands from WP-012, with a dialog for the amount.

**Acceptance criteria**

- Lyrics entered across a verse render aligned; transposing by a fret that pushes a note off the neck is refused with a message.

## WP-086: Editor end-to-end

- **Size**: S · **Blocked by**: WP-084
- **Packages**: `apps/web/e2e`

**Deliverables**

- E2E flows: new song, enter a riff, apply effects, insert bars with a repeat, copy and paste, undo to empty, redo, save native, export gp and reopen.

**Acceptance criteria**

- Green in CI.

---

# Audio lane → HQ sound checkpoint

## WP-090: SFZ loader

- **Size**: L · **Blocked by**: WP-056
- **Packages**: `packages/audio`

**Deliverables**

- An SFZ parser for the opcode subset HQ packs need: `<control>`, `<global>`, `<master>`, `<group>`, `<region>` headers with inheritance; `default_path`, `sample`, `lokey`, `hikey`, `key`, `pitch_keycenter`, `lovel`, `hivel`, `tune`, `transpose`, `volume`, `pan`, `loop_mode`, `loop_start`, `loop_end`, `ampeg_*`, `sw_lokey`, `sw_hikey`, `sw_last`, `sw_default`, `seq_length`, `seq_position`, `trigger`, `offset`; `#include` and `#define`. Unknown opcodes are ignored and counted.
- Region maps per keyswitch layer, so an articulation maps to a layer; lazy loading of each sample file from the pack directory through the platform adapter; FLAC and WAV through `decodeAudioData`.

**Acceptance criteria**

- Parses the SFZ files of the packs listed in `../reference/sound-packs.md` without errors; a synthetic SFZ fixture in the repo covers every opcode.

## WP-091: Sound pack manager

- **Size**: M · **Blocked by**: WP-090
- **Packages**: `apps/web/src/features/sounds`, `packages/audio`

**Deliverables**

- A pack manifest format: id, name, instrument family, GM programs it covers, format (sfz), source URL, license name and text URL, whether direct download is permitted, size, entry SFZ files per articulation set.
- A curated manifest list in the repo for the packs in the reference note; a sounds screen that lists packs, shows the license, downloads the ones that allow it into `dataDir()/sounds/<id>/` with progress, and for the others asks the user to drop the zip they downloaded themselves and verifies its contents.
- Per-track sound assignment in the mixer: GM (default) or an installed pack; stored per song; fallback to GM with a notice when a pack is missing.

**Acceptance criteria**

- Installing a bass pack and assigning it to the bass track changes the sound; removing the pack falls back to GM without an error.

## WP-092: Effects chains

- **Size**: M · **Blocked by**: WP-056
- **Packages**: `packages/audio`

**Deliverables**

- The channel strip's insertion point filled with a chain: input gain, wave-shaper drive with selectable curves (clean, overdrive, distortion, fuzz), tone stack as three biquads, cabinet convolution with a bundled small set of CC0 or self-generated impulse responses, modulation (chorus via modulated delay), delay with feedback, reverb convolution with a bundled room impulse, output gain.
- Presets keyed by GM program family (clean electric, overdriven, distortion, acoustic, bass, keys, drums, other) applied automatically; a preset picker per track in the mixer.
- Bypass per stage and a global "GM tier bypass" so the GM soundfont, which already contains distorted samples, isn't double-processed by default.

**Acceptance criteria**

- Offline tests assert that the distortion preset adds harmonics and that bypass is bit-identical to no chain.

## WP-093: HQ articulation layers

- **Size**: M · **Blocked by**: WP-090, WP-092
- **Packages**: `packages/audio`

**Deliverables**

- Mapping from model articulations to pack layers where present: palm mute, natural harmonic, hammer-on and pull-off, dead note, with the synthesized fallbacks from WP-033 used when a pack lacks a layer.
- Round-robin and velocity layer selection from SFZ `seq_*` and velocity ranges.

**Acceptance criteria**

- With the reference electric guitar pack, a palm-muted beat uses the muted layer, verified by region selection in a test.

## WP-094: Memory UI and tuning

- **Size**: S · **Blocked by**: WP-091
- **Packages**: `apps/web/src/features/sounds`, `packages/audio`

**Deliverables**

- A memory readout in the sounds screen and in the status bar: resident bytes against budget, resident instruments; a budget setting; an "unload unused" action.
- The HQ budget benchmark: four HQ tracks on the long fixture stay under the HQ budget in the table; the numbers recorded in the roadmap.

**Acceptance criteria**

- Budget tests pass in CI; lowering the budget in settings visibly evicts.

# Reprise: shared understanding

Agreed on 2026-11-05 between Tomer Shvadron and Claude after a structured interview. This is the baseline every plan, issue and decision record builds on. When something here changes, the change is recorded as an ADR in `../decisions/` and this document is updated to match.

## Purpose

Tomer played guitar a lot when younger and used Guitar Pro to learn songs. Reprise exists so he can play again. It is a personal tool, built for one user, that covers the three things Guitar Pro is used for:

1. **Player**: open a tab file, see it, hear it, slow it down, loop a section, play along.
2. **Trainer**: practice tools on top of the player: speed trainer, tuner, metronome, practice history.
3. **Editor**: write and correct tabs note by note.

Each of the three is built to an 80/20 cut. The exact keep, defer and drop lists are in `scope-v1.md`.

The name **Reprise** is the musical term for a section that returns, and the reason the project exists.

## Guiding principles

- **Own the core, borrow the commodities.** The score model, the layout engine, the renderer and the sampler are ours, because the editor has to own the model and the renderer is the soul of the product. File-format parsing of soundfonts, audio decoders, sound data, impulse responses and the notation font are borrowed.
- **Performance and memory are requirements, not polish.** Decoded audio is loaded lazily per region, only for the instruments a song uses, and evicted under an explicit budget. Layout is incremental and bounded. Budgets are asserted by tests in CI.
- **Lossless in, honest out.** Importing a Guitar Pro file keeps everything the file had, including things we don't render yet. Exporting to a Guitar Pro format warns when something will be dropped.
- **Keyboard first.** Every action has a shortcut or a command-palette entry. Guitar Pro's shortcuts are mirrored where they exist.
- **Engines are framework-free.** No React in `packages/*`. Enforced by lint, so the layout engine can move to a worker and the audio engine can be tested without a DOM.

## Platform

- **Computer only.** No phone or tablet. Reasons: a tab needs a wide layout, touch editing is a second interaction design, and iOS audio limits are hostile to sampled playback.
- **Web core, Electron shell.** Development happens in the browser via Vite. The shipped app is Electron, because bundling Chromium means one audio and rendering engine on macOS and Windows, tested once. macOS is required, Windows is built in CI as a nice-to-have. Builds are unsigned for now.
- **Stack**: TypeScript, React, Vite, Tailwind, shadcn/ui on Radix, Zustand, Immer, Dexie, pnpm workspaces, Vitest, Playwright, electron-vite, electron-builder.

## Architecture in one paragraph

Six packages. `model` holds the score data model, stable IDs, commands and undo. `formats` reads gp3/gp4/gp5, gp and gpx into the model and writes the native format and gp. `layout` turns a score into positioned glyphs with hit-testing geometry. `audio` is the sampler, scheduler, loaders and effects. `web` is the React app that paints layout output as virtualized SVG and drives the engines. `desktop` is the Electron shell with the platform adapter for files and the app data directory. `formats`, `layout` and `audio` depend only on `model` and not on each other, which is what makes parallel development possible. Details in `architecture.md`.

## Sound

- **Two tiers, one engine.** The General MIDI tier is a bundled SF2 soundfont (GeneralUser GS by default) that gives every track a sound out of the box. The HQ tier is per-instrument SFZ sample libraries downloaded through a sound pack manager. Both feed the same sampler, so articulations, bends and memory behave identically.
- **Per-voice pitch control** is required: two strings can bend by different amounts at once. This is why the sampler is ours rather than a MIDI-style synth.
- **Effects** are native Web Audio nodes: wave shaping for overdrive and distortion, convolution for cabinet impulse responses and reverb, biquad filters for EQ and wah, delay, compression, modulated delay for chorus. Presets are derived from the track's GM program.
- **Articulations are engine behavior**: bends are detune ramps, slides are glides, vibrato is an LFO, let-ring suppresses note-off, hammer-ons retrigger without attack, dead notes are a noise burst, palm mute and harmonics use a sample layer where the library has one and a filter plus short envelope where it doesn't.
- **Samples never live in git.** Sources and licenses are in `../reference/sound-packs.md`.

## Score model

- Fretted strings with any string count, any tuning and a capo. Drums on a percussion staff. Pitched non-fretted instruments on a single staff with a treble or bass clef; grand staff deferred.
- Four voices stored per bar, two editable in v1.
- Stable IDs on every track, bar, beat and note. Readers assign IDs on import.
- Immutable updates through Immer. Every edit is a named command that yields patches and inverse patches; undo and redo replay them.
- Time is in ticks at 960 per quarter note. A tempo map and a playback-order expansion (repeats, alternate endings, D.S., D.C., coda) produce the linear sequence the scheduler and the cursor follow.

## Display

- Per-track toggle between tab, standard notation and both. Default is tab for fretted instruments and standard for everything else. Rhythm stems under tab are always drawn.
- SVG painter with virtualized systems. Hit-testing uses layout geometry, not DOM events. Notation glyphs come from the Bravura font.
- Two view modes, paged and continuous horizontal scroll, plus zoom. Show all tracks or one.
- Printing via print CSS over the paged layout.

## Files

- **Read**: gp3, gp4, gp5, gp (Guitar Pro 7 and 8), gpx (Guitar Pro 6).
- **Save**: native `.reprise`, JSON with a schema version. Lossless for our model.
- **Export**: gp in v1, gp5 in phase 2. gpx, gp3 and gp4 are never written. MusicXML deferred. MIDI and ASCII tab import left out.
- alphaTab is a development-only dependency used as an independent oracle in tests, never shipped.

## App shape

- A **library app**: an app-managed folder under the Music directory, import copies a file in, a library screen with search and sort, and every song has a stable ID the practice log attaches to. Plus open-without-import for one-off viewing.
- Metadata, practice log and settings in IndexedDB via Dexie. Sound packs in the app data directory. Decoded audio only in memory under an LRU budget.
- Editor autosaves drafts for crash recovery. No telemetry.

## UI

- Guitar Pro's spatial layout: track list on the left, score in the center, transport pinned to the bottom, collapsible panels for the fretboard, the mixer and the speed trainer.
- Modern minimal style. Dark theme by default, light theme required. The score surface is paper-coloured on dark chrome, so it reads well for long sessions and prints without an inversion step.
- English-only UI.

## Process

- Public repo `tomer-shvadron/reprise`. `main` plus short-lived issue branches, PRs squash-merged, conventional commits.
- Every unit of work is a GitHub issue created from a work package in `../plans/`. Labels in three families: area, type, phase. Milestones per checkpoint. One Projects board.
- Agents open PRs; Tomer reviews in GitHub; CI must be green: lint, typecheck, tests, build. Commits and pushes happen only with Tomer's explicit go-ahead for that specific change.
- Release workflow on tags builds macOS and Windows installers and attaches them to a GitHub Release.

## Build order

Foundation and the model core are serial, done by the lead. Then three parallel lanes, score, audio and formats, each an agent in its own git worktree owning one package, converge on the **player checkpoint**: the first version Tomer can learn a song with. After that, four lanes run in parallel toward the library, trainer, editor and HQ sound checkpoints, then release. Full detail with sequential and parallel markings in `../plans/roadmap.md`.

## Testing

Model and formats: unit and round-trip tests, alphaTab as oracle. Layout: data snapshots plus Playwright image comparison on reference scores. Audio: OfflineAudioContext rendering with assertions on timing, pitch and eviction. App: Playwright end-to-end against the Electron build. Fixtures are hand-written, generated by our own writer, or taken from alphaTab's and TuxGuitar's open test data; downloaded tabs stay in a gitignored local folder. A performance benchmark asserts layout time and memory budgets in CI.

## Defaults taken without a dedicated decision

These were routine calls, open to revisiting:

- Keyboard shortcuts mirror Guitar Pro's where they exist.
- GeneralUser GS as the bundled GM soundfont.
- Initial decoded-audio budget of 300 MB, tunable in settings.
- Electron builds unsigned; first launch on macOS needs right-click Open.
- Repo commits use the same git identity as the other personal repos.
- No license file yet; the public repo is therefore all-rights-reserved until one is chosen.

## Where to go next

- The scope lists: `scope-v1.md`
- The package map and contracts: `architecture.md`
- Why each decision was made: `../decisions/README.md`
- What to build, in what order: `../plans/roadmap.md`

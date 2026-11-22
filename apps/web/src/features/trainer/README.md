# Trainer

**Owner**: the app lane (`[P:app]`, no package). **Filled by**: WP-070 (speed trainer), WP-071
(tuner), WP-072 (standalone metronome), WP-073 (practice log) and WP-074 (live fretboard).

It holds the speed trainer (WP-070) and the entry points the lead stubbed in WP-056 for the rest:

| Export                           | What it is                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TrainerPanel`                   | The speed trainer for its view and a placeholder for each other, naming its work package. The app shows it in the right panel for those views.                                                                                                                     |
| `trainerCommands` (`./commands`) | `trainer.speedTrainer`, `trainer.tuner`, `trainer.metronome` and `trainer.fretboard` (which toggles the bottom region), each showing its view, and the speed trainer's `trainer.speedTrainerToggle`, `trainer.speedTrainerMissed` and `trainer.speedTrainerReset`. |

## What it can rely on

- `ui.rightPanelView` and `ui.showPanelView(view)`: which tool the right panel shows
  (`'mixer' | 'speedTrainer' | 'tuner' | 'metronome' | 'effects' | 'history' | 'insights' | 'chords'`; the last two are not trainer tools, so `app.tsx` renders them and `TrainerView` excludes them). The fretboard lives in the bottom region
  instead: `ui.bottomPanel` (`{ open, view }`), `ui.toggleBottomPanelView('fretboard')` and
  `ui.bottomPanelHeight` (#206). `TrainerPanel` renders it there as `view="fretboard"`.
- `practice` (`state/practice.ts`), the running session WP-073 stores: `start` on first play, which
  returns the session of another document it replaces so it can be stored, `addPlayed`, `noteLoop`,
  `recordTempo`, `recordStep(range, percent)` when the speed trainer completes a full step (the
  range is `playback.settings.loop`), `setSongId` for a file imported mid-session, and `end()`,
  which returns the session for `practiceSessions`. Loops are bar ids, so they survive edits, and
  are ordered by last use so the last one is what "resume" restores.
- `document.songId` ties a session to its library song.
- `playback.lastLoop` and `playback.settings` for the loop event and the tempo; the speed trainer
  steps tempo through the audio service.

## The fretboard (WP-074)

`fretboard/` draws the current track's neck (its tuning, 24 frets, the capo) once as SVG and lights
the notes of the beat under the drawn playhead (`heard`), named. `fretboard-model.ts` precomputes a
bar-to-notes lookup per track when the score changes, so a tick is a binary search, and each bar is worked out on first use and cached per bar object (an edit recomputes one bar, a mixer change none); the position
reader repaints only the few lit dots, outside React, and only when the lit set changes. In edit
mode with the transport stopped, pausing included, it lights the edit cursor's beat. The left-handed flip is remembered
per viewer (`reprise.fretboardLeftHanded`). The highlights are not a live region.

A run state of the speed trainer is the feature's own (a store under this folder). Needing another
shared field is a `type:contract` issue for the lead.

## Speed trainer

`speed-trainer/`: `ramp.ts` (pure plan and per-pass reducer), `speed-trainer-store.ts` (the run),
`speed-trainer-for.ts` (one store per `AppServices`), `speed-trainer-panel.tsx`.

- **Model.** A ramp over the current loop: start, step and target (in percent or BPM), repetitions
  per step and what a miss does (repeat the step, or step down one, never past the start). Inside
  it all runs in percent of the written tempo, as the transport does; a BPM setting is converted
  at Start against the written tempo at the loop's first tick and kept as an exact percent. A
  target below the start ramps down; the last step is clamped to the target.
- **A step is applied synchronously inside the loop event.** The store listens with a plain
  `playback.subscribe` and calls `audio.setTempo('percent', p)` in that same call when a new
  `lastLoop` arrives. The engine emits `loop` as it wraps, before it schedules the next pass, and
  `setTempo` retimes from the wrap; a React effect, microtask or timer runs after the next pass
  is already scheduled at the old tempo, and the change lands mid-bar. Always percent mode: bpm
  mode reads the tempo at the heard tick, which is still the end of the old pass. The event fires
  up to the lookahead plus one scheduler tick (0.225 s) before the wrap is heard, so the panel
  shows the new step that much early. The store notifies a nested change more than once, so the
  listener remembers the loop event it counted and ignores its own `setTempo`.
  `speed-trainer.browser.test.ts` measures it on the real engine.
- **Recorded.** `practice.noteLoop(range)` at Start and `practice.recordStep(range, percent)` for
  each step completed cleanly (a missed or stepped-down step is not recorded). Without a session
  they do nothing. It does not call `start`, `end`, `addPlayed` or `recordTempo`: WP-073 owns the
  session and listens on `settings.tempo` for the tempo history.
- **What ends or holds a run.** Held: Hold, or the user changing the tempo (slider, field, keys).
  Reset to idle: the loop changes or is cleared, another document opens, or Reset. Pause and stop
  do not end it, and a part-played pass counts when it crosses the loop's end. A press of
  "Missed pass" in the 0.225 s between the event and the audible wrap counts for the next pass.
- The run lives in the store, outside React, so closing the panel does not stop it. The panel gets
  its buttons from the registry through `useCommand`, as the shell provides a command source around
  the right panel.
- **For WP-073.** Start calls `practice.noteLoop(range)` before the first play, when no session
  exists yet, so it is a no-op on a song's first play. Note the current `playback.settings.loop`
  when the session opens, or the loop is only recorded once a step completes. The unit toggle
  keeps the exact value, so flipping it twice changes nothing; the fields round for display.
- Keys: Alt+S start, hold or resume; Alt+X mark the pass missed; Alt+Shift+S reset.

## Tuner

`tuner/`: `pitch/` (`fft.ts`, `mpm.ts`, `tracker.ts`), `notes.ts`, `strings.ts`, `mic-errors.ts`,
`capture.ts` (the only file that touches Web Audio), `tuner-store.ts`, `tuner-for.ts`,
`tuner-panel.tsx`, `cents-meter.tsx`, `string-picker.tsx`, and `test-signals.ts` and `test-rig.ts`
(test-only). The store is vanilla zustand, one per `AppServices` like the speed trainer's.

- **Pipeline.** Microphone, two cascaded lowpass sections, an `AnalyserNode`, then every 20 ms a
  window read on the main thread, `detectPitch` (McLeod's method, the autocorrelation done by an
  FFT of the frame zero-padded to 2N) and `tracker.push`. The detector and tracker take plain
  `Float32Array` frames, so moving them into a worklet later changes only `capture.ts`. The mic
  is never connected to the destination; Chromium pulls an analyser with no output.
- **Raw capture.** `Platform.microphone()` asks for echo cancellation, noise suppression and
  automatic gain control off: the browser's noise suppression fades a sustained tone and the gain
  control pumps the level the gate watches.
- **Detector.** NSDF `n(τ) = 2r(τ)/m(τ)`, key maxima between positive zero crossings, the first
  at or above `k = 0.9` of the highest, a parabola through its neighbours. Lags run from
  `sampleRate / 1500` (above E6) to `sampleRate / (0.84 · lowest target)`, so a string three
  semitones flat is still found. `clarity` is `n(τ*)`.
- **Window.** `windowFor`: the smallest power of two that is at least 2048 and at least twice the
  longest lag, capped at 8192. That is 2048 for every guitar (7-string and drop tunings
  included) and 4096 when the lowest target is under about 56 Hz at 48 kHz (51 Hz at 44.1 kHz):
  4- and 5-string bass, a low B, and no track (a 30 Hz floor). It follows the current track's
  tuning and capo and changes live (`analyser.fftSize`).
- **Lowpass.** 1500 Hz while searching; once a note is locked the cutoff moves to
  `clamp(2.5 · f, 80, 1500)` with `setTargetAtTime`, and returns to 1500 Hz after five rejected
  frames or when the hold ends. Broadband noise is the main error source (a plucked tone at
  20 dB SNR is off by up to 14 cents unfiltered, under 3 filtered), and a stiff string's upper
  partials raise the autocorrelation (up to 15 cents sharp at a fixed 1.5 kHz). **Web Audio's
  lowpass `Q` is in dB**: a Butterworth section is `20·log10(1/√2)`, not 0.707, and
  `tuner.browser.test.ts` pins it against an `OfflineAudioContext` render.
- **Tracker thresholds** (`TRACKER` in `pitch/tracker.ts`, set by `tracker.test.ts` and `tracker-pipeline-*.test.ts`). A frame
  counts at −55 dBFS RMS or more, and while locked no more than 30 dB below the note's peak. A
  new note needs clarity 0.90, a lock continues to 0.80. Two accepted frames within 30 cents
  lock; three accepted frames more than 50 cents from the median move the lock, and a single
  octave-off frame is ignored. The reading is the median of the last five accepted frames in
  fractional MIDI, or of eleven at the 4096 window (over 50 ms), where a splice from dropped
  samples spans up to five frames; the gates still judge against the newest five (#474). When
  the gate closes the last reading is held 1.5 s (`held`, dimmed), then clears. In tune is entered after five readings within 3 cents and left beyond 5. A **glitch
  gate** freezes the reading (undimmed) for up to 8 frames that sit more than 2 cents from the
  median with the clarity 0.05 under the note's running clarity, or 0.02 under it when the frame
  is also more than 8 cents from the last frame the history took (a dropout, not a peg turn,
  which moves a few cents a hop). The frame right after a rejected one is a new pluck and skips
  the gate.
- **Settling.** Moving the cutoff changes the filter under a loud periodic tone, and for as long
  as the window still holds the change the frames read tens of cents off at high clarity (the
  browser test showed 17 to 19 cents). So whenever the cutoff closes in (a fresh lock, a move to
  a lower note, or a string plucked again inside the hold after the silence opened the cutoff)
  the reading is hidden, or shown held, for `settleFramesFor(window)` hops (7 at 2048 and 48 kHz,
  9 at 4096), counted in time, not in accepted frames. The frames taken through the old cutoff
  are dropped, and the first median is the frames after it. That first reading waits until its
  frames agree within 2 cents, or until there are five (at most 2 hops, 40 ms, more, only when
  the first three spread over 2 cents; at 2048 the spread is judged over the whole fill): dropped samples bias several frames in a row (#433). A
  fresh note shows a reading about 8 hops (0.16 s) after the window fills. At the 4096 window
  six frames must agree, or eleven are taken (#474): dropped samples then stay within 1.1 cents,
  at the cost of the first reading about 3 hops (60 ms) later, 8 hops (160 ms) in the worst
  case, and a needle that trails a peg turn by 5 hops (100 ms) instead of 2. Moving to a nearby
  note without the cutoff closing in still shows readings from three frames, so a splice in the
  first 100 ms after such a move is not covered.
- **Allocation.** `createDetector(n)` owns the FFT tables and every buffer, and the tracker sorts
  its median in a scratch array, so a frame allocates only its small result objects; the panel
  re-renders only the readout per frame. Over 5000 frames (100 s of hops) in Node: 0 GC events
  (18 and 34 before at 2048 and 4096) and about 0.7 KB of heap a frame.
- **Accuracy** (seeded synthetic plucks, 44.1 and 48 kHz, B0 to E5, detunes −23 to +41 cents,
  three seeds, every reading once locked): harmonic at 30 dB SNR within 0.92 cents; at 20 dB
  within 2.5 cents; an inharmonic string (B = 3e-4, weak fundamental) at 30 dB within 2.0 cents.
  Pure sines within 0.1 cent.
- **Own AudioContext.** Made synchronously in the click that starts listening (so the user
  activation lets it run), with no fixed sample rate and, where the engine supports it,
  `sinkId: { type: 'none' }`. Closed when listening stops. It never touches the playback
  engine and never pauses it; while a song plays the panel suggests headphones.
- **Privacy.** Audio is processed in memory one window at a time and overwritten. Nothing is
  recorded, stored, logged, sent anywhere or put in the practice log. The mic is on only while
  the user wants it (`wanted`, set by Start and cleared by Stop and a permission error), the
  panel is mounted and the page is visible. Stopping stops every track, disconnects the nodes
  and closes the context.
- **Errors and devices.** `mic-errors.ts` maps a rejection to `denied`, `noDevice`, `busy`,
  `unsupported`, `lost` or `failed`, each with a message and "Try again". A track that ends
  restarts once and then reports `lost`. A `devicechange` while listening restarts capture after
  500 ms, since Chromium does not move a live track to a new default device; in `noDevice` or
  `lost` it retries. The input device cannot be chosen: `microphone()` takes none.
- **Display.** Note, octave, frequency and a ±50 cent meter (`role="meter"`). The panel lists the
  current track's strings, from the lowest, with the capo added; auto picks the nearest target
  within 300 cents and keeps it until another is 50 cents nearer, and a click pins a string until
  Auto, a track change or a document change. With no fretted track the tuner is chromatic.
  Beyond ±50 cents the needle pins and a label says how far to tune. A4 is a whole number from
  415 to 466 in `reprise.tuner.referenceHz`.
- **Command.** `trainer.tunerToggle` ("Start or stop tuner") shows the panel and toggles; it has
  no default shortcut (Guitar Pro has none, and Alt+T is "Set tempo…").
- **Tests.** `fft`, `mpm` and `tracker` tests on seeded signals; `tuner-store.test.ts` and
  `tuner-panel.test.tsx` on a fake microphone and manual timers (`test-rig.ts`);
  `tuner.browser.test.ts` on real Web Audio; `e2e/player/tuner.spec.ts` on Chromium's fake
  microphone (see the e2e README for why it runs in full Chromium, on Linux).

## Metronome

`metronome/`: `metronome-panel.tsx` and `tap-tempo.ts` (pure). The panel drives the audio service's
standalone click (`startClick`, `updateClick`, `stopClick`) and reads `playback.click`, so it
works with no song open and its settings survive a stop. The click and a song never sound
together: starting one stops the other.

- BPM (10 to 600) with tap tempo (the last 8 taps, restarting after a 2 s pause, so tapping reaches
  down to 30 BPM and slower tempos are typed), beats per bar (1 to 32) over a beat note of 2, 4 or
  8, clicks per beat (1 to 4, relative to the beat so they are right in every meter), downbeat
  accent and volume. For x/8 with x a multiple of 3 (6/8, 9/8, 12/8) a switch, on by default,
  counts in dotted quarters: the panel keeps showing 6/8 and the engine gets
  `{ beatsPerBar: 2, subdivision: 3 }`. The meter lives in `metronome-store.ts`, outside React, so
  it survives a panel switch.
- The click keeps running when the panel closes or another screen opens; Alt+B and the palette stop
  it from anywhere. While it runs, a "Metronome on" segment in the status bar
  (`app/status-bar/click-status.tsx`, #220) shows it and stops it when pressed; it shrinks to its
  dot in a narrow window. The practice mode hides the status bar, so nothing shows it there yet.
- Alt+B starts or stops it; only starting shows the panel (stopping, from the status bar too, opens
  nothing). `metronome.browser.test.ts` renders the click
  offline at 60, 120 and 200 BPM and measures the onsets.

## Practice log (WP-073)

`practice-log/`. Logs each song's practice into the library database's `practiceSessions` table
(Dexie version 2) and shows it on a song page in the library.

- **Capture** (`capture.ts`, `accrual.ts`), installed by the shell with
  `installPracticeLog(services, libraryOf(services).db.practiceSessions)`; the trainer never imports
  library internals. It runs over the existing `practice` store and changes no state. A session starts on a document's first
  play and counts only time `playing` (the count-in is left out). It ends on a document switch or
  close, or after 10 minutes without playing; the check also runs when play starts, so a missed
  timer changes nothing. Nothing runs on the position tick: the subscription compares `transport`,
  the loop and the tempo by reference. Played time is added up at play and pause changes and every
  30 s while playing, by the monotonic clock (one accrual is capped at 60 s, so a sleeping laptop logs nothing extra).
  Writes are debounced by 1 s, and `pagehide` or a hidden window flushes at once. No row is written
  below 10 s of play or one completed speed-trainer step. A file open without import (no `songId`)
  is not stored; importing it mid-session starts storing it.
- **Row** (`row.ts`): a zod schema, owned here; the library's `schema.ts` imports only its type. A
  loop is stored by bar id (the truth) with its bar numbers and BPM at write time for display while
  the song is closed. A deleted song's rows stay in the table, hidden: nothing lists them.
- **Song page** (`song-page.tsx`, `summary.ts`): total time, sessions newest first, loops with their
  best tempos, and Resume. Resume restores the most recent session's last loop at that session's
  last tempo (`resume.ts`), by bar id, so it still works after bars were inserted before the loop; a
  loop whose bars are gone restores the tempo only and says so. The library's song list has a
  "Practice log" button per row and its screen hosts the page.
- **Privacy.** The log lives only in this machine's IndexedDB: no network call, no `localStorage`,
  never in the `.reprise` file, a gp export or the draft. The tuner's microphone and the standalone
  metronome are never observed: the capture imports nothing from `tuner/` or `metronome/`.
- Not done: a weekly summary and streaks (they would want a `startedAt` index, a Dexie version 3),
  export of the log, pruning or a clear-history button, and a Resume command.
- **In the practice mode (#341)** starting the speed trainer, the standalone metronome or the tuner
  (⌥S, ⌥B, the capsule's chip) does not show their panel, because a panel would end the mode; the
  capsule's `SpeedTrainerChip command="trainer.speedTrainerToggle"` shows the progress and the
  trainer announces its own steps. The explicit "Show ..." commands still open the panel.

## Chords panel (#352)

`chords/` is the Chords sub-tab of the right panel's Song tab (beside Insights): a name field (with the song's own chord names as buttons), the current track's tuning and capo, and cards of generated shapes from `lib/chords`, painted by the layout's `chordDiagramPrimitives`. A card strums the shape (`strum.ts`, one `previewNote` per sounding string, 25 ms apart); in edit mode two buttons write the picked shape to the cursor's beat or to every beat of that name (`write-shape.ts`, one "Chord diagram" undo step each). `trainer.chords` and the score.chord item `trainer.chordShapesFor` open it. An empty tab seeds its name from the cursor's chord, the playhead's, then the song's first. A switch in the tab turns the chord strip (`score.chordStrip`, drawn by `app/chord-strip.tsx`, see the score README) on and off.

### The scale overlay (#353)

`fretboard/scale-dots.ts` lists every position that sounds a tone of a scale (the capo and a banjo's
short string included; at most 250), and `fretboard.tsx` draws them as hollow rings under the lit
notes, the tonic heavier. `fretboard/scale-overlay.ts` holds the chosen scale in a store per
document store (`scaleOverlayFor`): a song or section overlay goes when another document opens, a
manual pick stays, nothing persists. The header carries a chip with a clear button and the scale
tool (`scale-picker.tsx`, a tonic and a scale from `SCALES`). `trainer.fretboardSongScale` asks the
insights store for the song's scale (`songScaleOf`) and `trainer.fretboardClearScale` hides the
overlay; neither has a default key. Tones are spelled by degree (A blues has E♭, D harmonic minor a C♯) and a
picked tonic keeps its spelling. A song overlay retains the insights store while it shows and takes
each new result's scale, so it follows edits; while the song has no scale it stays on, draws nothing and the chip reads "Song scale: none found".

### Song insights (#353)

`insights/` is the Song tab's Insights view. The analysis itself is the pure `lib/insights`; this
folder is its app side. `insights-client.ts` extracts the note table on the main thread (cached per
bar, so an edit re-extracts one bar) and transfers its buffers to `insights.worker.ts`, a module
worker made on the first request; where there is no `Worker` (jsdom) it analyses inline. The score is
never cloned, which would cost about 20 times the analysis. `insights-store.ts` (`insightsFor`)
analyses only while retained (the panel is mounted or a song overlay shows), at once on a document
open and 400 ms after the last edit, one request at a time with the latest winning, caching per
score object and dropping an answer for a score that is no longer open. "Analysing…" is announced
only after 300 ms. When nothing wants the insights (the panel unmounted, no song overlay, the document closed) the worker is ended and a later request makes a new one; a document open is analysed one macrotask after the open. `insights-panel.tsx` shows the Key, Scale, Key changes, Sections, Chords, Shape and Tracks cards (`cards/`);
`trainer.insights` opens it. A scale's name in a card is its fretboard switch (`cards/scale-toggle.tsx`, `aria-pressed`, a `HintTooltip`): it sets a `section` overlay through `show-scale.ts`, which describes that stretch and does not follow edits; the song's own scale runs `trainer.fretboardSongScale` inside a `CommandTooltip`, so it does follow them. A card offers a scale only where no card above does: the Sections card shows a section's key and scale only when they differ from the song's, and a track's scale in a section only when it differs from the track's whole-song scale (the Tracks card). A section's name seeks to its first bar (the shared `seekToBar`: it announces a bar that is never played, and turns an active practice loop off when the section lies outside it, as a click in play mode does). A chord chip ("Am ×3", with how often the chord comes in and its share of the time) sets the Chords sub-tab's name and opens it. `trainer.sectionInsights`, on the `score.section` menu (and from the palette, for the section under the edit cursor), opens the view and asks the store to `focusSection`: the Sections card scrolls the row in, moves focus to its name button (the menu host restores focus to the invoker before it runs the command, so nothing undoes this), announces it, tints it until the next key or pointer press and then clears the request, so a remount does not scroll again.

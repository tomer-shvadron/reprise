# Trainer

**Owner**: the app lane (`[P:app]`, no package). **Filled by**: WP-070 (speed trainer), WP-071
(tuner), WP-072 (standalone metronome), WP-073 (practice log) and WP-074 (live fretboard).

It holds the speed trainer (WP-070) and the entry points the lead stubbed in WP-056 for the rest:

| Export                           | What it is                                                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrainerPanel`                   | The speed trainer for its view and a placeholder for each other, naming its work package. The app shows it in the right panel for those views.                                                                                   |
| `trainerCommands` (`./commands`) | `trainer.speedTrainer`, `trainer.tuner`, `trainer.metronome` and `trainer.fretboard`, each showing its view, and the speed trainer's `trainer.speedTrainerToggle`, `trainer.speedTrainerMissed` and `trainer.speedTrainerReset`. |

## What it can rely on

- `ui.rightPanelView` and `ui.showPanelView(view)`: which tool the right panel shows
  (`'mixer' | 'speedTrainer' | 'tuner' | 'metronome' | 'fretboard'`). The fretboard is meant for a
  bottom region (WP-074); until the shell has one it shares the right panel, and a bottom region is
  a shell change for the lead (#206). The standalone metronome needs the audio change of #205.
- `practice` (`state/practice.ts`), the running session WP-073 stores: `start` on first play, which
  returns the session of another document it replaces so it can be stored, `addPlayed`, `noteLoop`,
  `recordTempo`, `recordStep(range, percent)` when the speed trainer completes a full step (the
  range is `playback.settings.loop`), `setSongId` for a file imported mid-session, and `end()`,
  which returns the session for `practiceSessions`. Loops are bar ids, so they survive edits, and
  are ordered by last use so the last one is what "resume" restores.
- `document.songId` ties a session to its library song.
- `playback.lastLoop` and `playback.settings` for the loop event and the tempo; the speed trainer
  steps tempo through the audio service.

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

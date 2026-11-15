# Trainer

**Owner**: the app lane (`[P:app]`, no package). **Filled by**: WP-070 (speed trainer), WP-071
(tuner), WP-072 (standalone metronome), WP-073 (practice log) and WP-074 (live fretboard).

Today it holds only the entry points the lead stubbed in WP-056:

| Export                           | What it is                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `TrainerPanel`                   | A placeholder per view, each naming its work package. The app shows it in the right panel for those views.   |
| `trainerCommands` (`./commands`) | `trainer.speedTrainer`, `trainer.tuner`, `trainer.metronome` and `trainer.fretboard`, each showing its view. |

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

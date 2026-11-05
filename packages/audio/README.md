# @reprise/audio

The playback engine: the transport and lookahead scheduler (WP-030), the sampler (WP-031), the
SF2 loader (WP-032), articulations (WP-033) and the memory manager (WP-034). This README covers
what exists so far, the transport, and the contract the sampler plugs into.

## Architecture

```
main thread                                     audio thread (native Web Audio)
-----------                                     -------------------------------
25 ms worker timer -> advance(run, now, now + 0.2) --> InstrumentSink.noteOn -> sampler nodes --+
                                                  \--> MetronomeSink.click  -> click gain ------+-> destination
animation frame -> currentTime -> position event
```

- **The main thread only schedules; Web Audio mixes.** Every 25 ms the engine calls
  `advance(timeline, run, { now, horizon: now + 0.2 })`, which hands out every note and click due
  in the next 200 ms with an absolute `AudioContext` time. Sinks turn them into native nodes
  started at that time, so a late timer never makes a note late, only the next window shorter.
  The timer itself runs in a dedicated worker (`workerTicker`): browsers slow a hidden page's
  main-thread timers to once a second as soon as it stops being audible (a long rest is enough),
  and at that cadence a 200 ms lookahead plays 200 ms of every second. Worker timers are not
  throttled; where workers are unavailable, or a CSP forbids a blob worker, it falls back to
  `setInterval`.
- **The core is pure.** `advance`, `startRun`, `retime` and `withLoop` (`src/scheduler.ts`) take
  and return plain data and never touch Web Audio or a timer, so moving the scheduler into a
  worker or an AudioWorklet (ADR-0004's documented mitigation) changes only `engine.ts`.
- **Time is an anchor plus the model's tempo map.** A `Timeline` is the score expanded with
  `expandPlaybackSequence` and timed with `tempoMap`. The run's anchor says "playback tick _t_
  sounds at context time _T_, at rate _r_"; a later tick sounds at
  `T + (secondsAtTick(t') − secondsAtTick(t)) × r`. A tempo change, seek or loop wrap starts a
  new anchor at the scheduling cursor, so nothing already handed out ever moves.
- **Position is read from the audio clock.** At animation-frame cadence (a 16 ms timer where
  there are no frames) the engine maps `currentTime` back through the anchor in effect and
  `positionAtSeconds`, so the cursor is smooth and independent of the scheduling tick.

## The `InstrumentSink` contract (for WP-031)

Defined in `src/sink.ts`. The sampler implements this; the engine never creates audio nodes for
notes itself.

```ts
interface InstrumentSink {
  noteOn(event: NoteEvent): void;
  allNotesOff(when: number): void;
  dispose?(): void;
}
interface NoteEvent {
  track: Track;
  trackIndex: number;
  voiceIndex: number;
  beat: Beat;
  beatIndex: number;
  note: Note;
  when: number; // AudioContext time of the onset, >= currentTime at the call
  duration: number; // seconds to the release, ties folded in, at the tempo when scheduled
  playbackTick: number; // PlaybackPosition.playbackTick of the onset
  durationTicks: number; // the same length in ticks
  sequenceIndex: number; // the pass in the playback sequence
  masterBarIndex: number; // the bar the beat is in, and which play of it
  passIndex: number;
  barEnd: number; // AudioContext time the bar ends: the latest a let-ring note sounds
  nextOnString: { note: Note; beat: Beat; when: number } | undefined; // a slide's target
}
```

- `noteOn` arrives up to 200 ms before `when`, once per sounding note, in tick order within a
  window. The sink schedules both the start and the release; there is no per-note off. A beat
  with grace notes played **before** it is handed out early by their length as well (capped at a
  quarter note), because a 16th grace is 250 ms at 60 BPM and 500 ms with the speed trainer at
  half speed, longer than the lookahead: the sink places the grace ahead of `when` and still has
  the time to do so.
- **Ties** are resolved by the scheduler: a tied continuation is never sent and its length is
  added to the origin's `duration`, following the voice across bar lines in playback order. The
  one exception is a tie on the exact tick where playback starts or a loop wraps, which arrives
  as an onset so the bar does not start silent.
- Everything else about a note (velocity from `dynamics`, accents, palm mute, bends, let ring,
  strokes, grace notes) is the sink's business: the event carries the whole `Note`, `Beat` and
  `Track`, and `duration` is in seconds so bend points (0 to 60 across the note) map directly.
  Two things the sink cannot work out alone come with the event, because they need the playback
  sequence and the tick-to-time mapping: `barEnd`, where a let-ring note stops at the latest, and
  `nextOnString`, the note on the same string in the beat after this one ends (in playback order,
  so across a bar line it is the next pass's bar) with the time it starts, which is what a shift
  or legato slide glides into. It is `undefined` off fretted tracks, where a rest follows, and
  where the loop or the song ends first. `masterBarIndex` and `passIndex` locate the beat in the
  score the way `PlaybackPosition` does.
- `allNotesOff(when)` must cancel every note sounding at `when` **and every note already
  scheduled to start after it**: the scheduler has handed out up to 200 ms of the future. Stop
  the source nodes rather than only muting them, or every cancelled note keeps a node running
  until its original stop time; `stop(when)` on a node whose start time is later makes it
  produce nothing and end at once, and a second `stop` replaces the first. It is called with
  `when = currentTime` on pause, stop and seek.
- `MetronomeSink` (`click(when, accent)`, `silence(when)`, `setVolume(volume)`) is the same
  idea for the metronome and the count-in; `ClickSynth` is the built-in one.

Stand-ins shipped here: `RecordingSink` (implements both sinks, makes no sound, records each
event with the `currentTime` it was handed out at) for tests, and `ToneSink` (one oscillator
per note at the note's MIDI pitch) for listening before the sampler exists.

## Transport API

`createAudioEngine({ context, sink, metronome?, scheduler?, frames?, lookahead?, startLatency? })`
returns the frozen `AudioEngine` contract. `scheduler` and `frames` are injectable `Ticker`s so
offline tests drive the engine deterministically (`src/offline-driver.ts` suspends an
`OfflineAudioContext` every 1024 frames and fires both).

| Method                          | Behaviour                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load(score)`                   | Builds the timeline and resolves. Instrument decoding arrives with WP-034; the options are accepted and ignored until then.                                                 |
| `play(fromTick?)`               | Starts from `fromTick`, the paused tick, or the start. A tick outside the loop starts at the loop start. Counts in when count-in is on. Resumes a suspended `AudioContext`. |
| `pause()`                       | Keeps the current tick, cuts every scheduled note and click.                                                                                                                |
| `stop()`                        | Cuts everything, returns to the loop start or the song start.                                                                                                               |
| `seek(tick)`                    | While playing: cuts, restarts from `tick` after `startLatency`, no count-in. Otherwise moves the resume point. Past the loop end, playback restarts at the loop start.      |
| `setTempo('percent', p)`        | Scales the whole tempo map: 50 plays at half speed.                                                                                                                         |
| `setTempo('bpm', b)`            | Scales the whole map so the tempo at the current position plays at `b`; other tempo regions keep their ratio to it. The factor is fixed until the next `setTempo`.          |
| `setLoop({ startBar, endBar })` | Master-bar ids, inclusive. In playback order the occurrence holding the playhead wins, then the next one, then the first. `undefined` clears the loop.                      |
| `setCountIn(on)`                | One bar of clicks before the first beat (see below).                                                                                                                        |
| `setMetronome(on, volume)`      | A click per beat of the time signature, accented on the downbeat; `volume` 0 to 1 also sets the count-in's level.                                                           |
| `on(event, handler)`            | `position`, `state`, `loop`, `memory`; returns an unsubscribe.                                                                                                              |
| `dispose()`                     | Cuts everything, stops the timers, drops handlers, disposes the sinks.                                                                                                      |

Ticks given to `play` and `seek` are **playback ticks** (`PlaybackPosition.playbackTick`), which
count every pass of a repeat; a written-order tick from `tickOf` is the same thing in a score
without repeats or jumps.

Not yet implemented, and why: `setTrack` and `previewNote` throw (they belong to the sampler's
channel strips, WP-031); `memory()` reports zero bytes against the 300 MB default budget and
the `memory` event never fires (WP-034).

Events:

- `state`: `'stopped' | 'counting-in' | 'playing' | 'paused'`, on every play, pause, stop and
  seek, when a count-in ends, and when playback reaches the end of the song.
- `position`: `{ position: PlaybackPosition, masterBarId, seconds, countingIn }` every frame
  while playing and once after every transport call. `seconds` is in the written tempo map
  (unscaled), so it can be fed back to `positionAtSeconds` for another track's `beatIndex`.
- `loop`: `{ pass, when }` each time the scheduler wraps the loop, `pass` counting from 1.

## Timing guarantees

- Every event is handed out with `when >= currentTime`. An event the timer reached up to 50 ms
  late (a starved main thread) is moved to `currentTime` and shortened by the same amount; a
  later one is dropped rather than played out of time.
- Onsets are exact to the tempo map: the offline tests measure every onset of a four-bar score
  at 120 BPM at its expected sample, and through `RecordingSink` the times match to 1e-9 s.
- A loop wraps on the exact tick: the first note of the next pass is one beat after the last
  note of the previous, with no gap or overlap.
- A tempo change takes effect at the scheduling cursor, at most 200 ms after the call: events
  already handed out keep their time, and the gap straddling the cursor is part old tempo and
  part new.
- The `loop` event fires when the scheduler wraps, up to 200 ms before the wrap is heard
  (`when` says when). `advance` returns right after a wrap and the engine emits the event before
  scheduling the next pass, so a speed trainer that calls `setTempo` from the handler gets the
  new tempo from the first note of the pass.

## Decisions

- **Count-in.** One bar of the time signature where playback starts, at the tempo there
  (percent or BPM scaling included), accented on its first click. Starting at the beginning of
  an anacrusis, the count-in is shortened by the pickup so the two make one bar: a one-beat
  pickup in 4/4 gets three clicks. The count-in sounds whether or not the metronome is on.
- **Metronome beats** follow the time signature's denominator: 6/8 clicks six eighths. An
  anacrusis bar is aligned to the end of its bar, so a one-beat pickup clicks beat four.
- **Loop start.** Pressing play outside the loop starts at the loop start, as Guitar Pro does.
  Seeking before the loop while playing plays from there into it. Seeking past its end, or setting
  a loop that is already behind the playhead, jumps to the loop start without counting a pass or
  firing `loop`: only a loop end reached by playing is a crossing.
- **End of song.** Playback stops when the clock passes the end of the last bar, so the last
  note sounds its full length, and returns to the start (or the loop start).
- **Tests run in Vitest browser mode on headless Chromium** (`../../docs/research/2026-11-05-vitest-web-audio-environment.md`):
  the real `OfflineAudioContext`, driven through `suspend` points so the scheduler's timer is
  simulated deterministically.

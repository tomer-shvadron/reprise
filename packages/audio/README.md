# @reprise/audio

The playback engine: the transport and lookahead scheduler (WP-030), the sampler (WP-031), the
SF2 loader (WP-032), SFZ loader (WP-090), articulations (WP-033) and the memory manager (WP-034), composed by
`createAudioEngine` into the frozen `AudioEngine` contract (#94). This README covers the transport
and the contract the sampler plugs into first, then the engine that owns them all, the sampler
itself, the SF2 loader, the articulation layer between the scheduler and the sampler, and the
memory manager.

## Architecture

```
main thread                                     audio thread (native Web Audio)
-----------                                     -------------------------------
25 ms worker timer -> advance(run, now, now + 0.2) --> InstrumentSink.noteOn, mix -> sampler voices, strips -+
                                                  \--> MetronomeSink.click  -> click gain ----------------+-> master bus -> destination
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
  worker or an AudioWorklet (ADR-0004's documented mitigation) changes only `transport.ts`.
- **Two layers.** `createTransport` (`src/transport.ts`) is the sink-driven core: timeline,
  scheduler, clock and events, over any `InstrumentSink`. `createAudioEngine` (`src/engine.ts`)
  composes it with the `AudioContext`, the sampler, the metronome on the master bus, the memory
  manager and the GM bank, and is what the app uses.
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
  mix?(event: MixEvent): void; // a beat's mixer change, rests and tied continuations included
  hit?(event: HitEvent): void; // a beat's golpe, rests and tied continuations included
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
  continuations: { note: Note; beat: Beat; when: number; durationTicks: number }[]; // tied links, in order
}
interface MixEvent {
  track: Track;
  trackIndex: number;
  voiceIndex: number;
  beat: Beat;
  beatIndex: number;
  mix: MixerChange; // Beat.mix
  when: number; // AudioContext time of the beat; currentTime when handed out late; the run's start when replayed
  playbackTick: number;
  secondsPerTick: number; // at the beat, to time the change's duration
  sequenceIndex: number;
  masterBarIndex: number;
  passIndex: number;
}
```

- `noteOn` arrives up to 200 ms before `when`, once per sounding note, in tick order within a
  window. The sink schedules both the start and the release; there is no per-note off. A beat
  with grace notes played **before** it is handed out early by their length as well (capped at a
  quarter note), because a 16th grace is 250 ms at 60 BPM and 500 ms with the speed trainer at
  half speed, longer than the lookahead: the sink places the grace ahead of `when` and still has
  the time to do so.
- **Ties** are resolved by the scheduler with the model's own chain (`tieChainOf`, #65): a tied
  continuation is never sent and the chain's length is added to the origin's `duration`, however
  many beats of other strings (or rests) sit between the links, following the voice across bar
  lines while the bars play in score order. A repeat or jump between two links ends the hold
  there. A tie whose origin did not play just before it in this run, because playback started or
  a loop wrapped after the origin or a repeat jumped back to it, arrives as an onset instead, so
  nothing goes silent. The links themselves come with the event as `continuations`, each with its
  `when` and `durationTicks`, clipped to the loop or song end: an effect written on a later link
  (a hold bend, a slide out, vibrato) starts there. The articulation layer plays them on the
  origin's voice; see **Articulations → Tied links** below.
- **A golpe** arrives as a `HitEvent` through `hit`, one per beat carrying `BeatEffects.golpe`
  (`thumb` or `finger`), on a rest or a tied continuation too, which send no `NoteEvent`; it is
  beat-level, so it cannot ride on a note. It is an event, not state: a run start does not
  replay the hits before it (`hitsInRange`, which mirrors `mixesInRange` without the replay),
  and `allNotesOff` cancels one like a note. `ToneSink` has no `hit`. A pick scrape needs no
  event: it is `Note.pickScrape` on the ordinary `NoteEvent`.
- **Mixer changes** arrive as `MixEvent`s through `mix`, one per beat carrying `Beat.mix`,
  whether the beat is played, a rest or a tied continuation; a `NoteEvent` with no note was the
  alternative, but it would make `note` optional for every consumer and send a mixer change once
  per note. `mix` is the one place mixer changes arrive, so a sink does not read `beat.mix` in
  `noteOn`. A change handed out late is moved to `currentTime`, never dropped, because it holds
  for the rest of the song. **A run start replays the state.** When playback starts from a tick,
  seeks, or a loop wraps, every change before the run's start point is sent again first, in
  playback order, at the run's start and with its transition stripped (it has run its course),
  so a song that halves a track's volume in bar 2 and is started from bar 10 plays at half
  volume. What is not restored is the baseline those changes build on, `track.channel`: a change
  outlives a stop until the next run replays or writes over it, and the mixer panel's `setTrack`
  (WP-050) owns that reset.
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
  produce nothing and end at once, and a second `stop` replaces the first. It must also drop
  every mixer change scheduled after `when` (a strip's volume and pan, a program change): the
  scheduler sends each again when playback reaches its beat. It is called with
  `when = currentTime` on pause, stop and seek.
- `MetronomeSink` (`click(when, accent, subdivision?)`, `silence(when)`, `setVolume(volume)`) is the same
  idea for the metronome and the count-in; `ClickSynth` is the built-in one. **Route it through
  the sampler's master bus**, `new ClickSynth(context, sampler.master.input)`: the bus's limiter
  delays everything through it by about 6 ms (see the sampler's "limiter" note), so a click sent
  straight to the destination lands 6 ms ahead of the notes. `createTransport`'s default
  `ClickSynth` goes to the destination only because the transport has no sampler of its own;
  `createAudioEngine` routes its own through the bus.

Stand-ins shipped here: `RecordingSink` (implements both sinks, makes no sound, records each
event with the `currentTime` it was handed out at) for tests, and `ToneSink` (one oscillator
per note at the note's MIDI pitch) for listening before the sampler exists.

## Transport API

`createTransport({ context, sink, metronome?, scheduler?, frames?, lookahead?, startLatency?, onRunStart? })`
returns a `Transport`, the core of the engine over any sink (it was `createAudioEngine` before
#94). `scheduler` and `frames` are injectable `Ticker`s so offline tests drive it
deterministically (`src/offline-driver.ts` suspends an `OfflineAudioContext` every 1024 frames
and fires both). `onRunStart` runs as each run starts (play, resume, a seek or a load while
running), before its first window is handed out; the engine resets the channel baseline there.

| Method                          | Behaviour                                                                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load(score)`                   | Builds the timeline. The first load is `stopped` at tick 0; a load over a loaded timeline keeps the position and the state by the placement rule below, and the loop if its bars survive. |
| `unload()`                      | Cuts if running, drops the timeline and the loop, `stopped` at tick 0. `seek` throws until the next `load`.                                                                               |
| `play(fromTick?)`               | Starts from `fromTick`, the paused tick, or the start. A tick outside the loop starts at the loop start. Counts in when count-in is on. Resumes a suspended `AudioContext`.               |
| `pause()`                       | Keeps the current tick, cuts every scheduled note and click.                                                                                                                              |
| `stop()`                        | Cuts everything, returns to the loop start or the song start.                                                                                                                             |
| `seek(tick)`                    | While playing: cuts, restarts from `tick` after `startLatency`, no count-in. Otherwise moves the resume point. Past the loop end, playback restarts at the loop start.                    |
| `setTempo('percent', p)`        | Scales the whole tempo map: 50 plays at half speed.                                                                                                                                       |
| `setTempo('bpm', b)`            | Scales the whole map so the tempo at the current position plays at `b`; other tempo regions keep their ratio to it. The factor is fixed until the next `setTempo`.                        |
| `setLoop({ startBar, endBar })` | Master-bar ids, inclusive. In playback order the occurrence holding the playhead wins, then the next one, then the first. `undefined` clears the loop.                                    |
| `setCountIn(on)`                | One bar of clicks before the first beat (see below).                                                                                                                                      |
| `setMetronome(on, volume)`      | A click per beat of the time signature, accented on the downbeat; `volume` 0 to 1 also sets the count-in's level.                                                                         |
| `on(event, handler)`            | `position`, `state`, `loop`; returns an unsubscribe.                                                                                                                                      |
| `dispose()`                     | Cuts everything, stops the timers, drops handlers, disposes the sinks.                                                                                                                    |

Ticks given to `play` and `seek` are **playback ticks** (`PlaybackPosition.playbackTick`), which
count every pass of a repeat; a written-order tick from `tickOf` is the same thing in a score
without repeats or jumps.

**One placement rule for `seek` and for a `load` over a loaded song** (#94's Q5): the tick (for a
load, the playhead's tick on the old timeline) is clamped to the new score; if running, the sound
is cut and a run starts there after `startLatency`, with no count-in, as `playing`; otherwise the
resume point moves there and the state stays what it was (`paused` stays `paused`, `stopped`
stays `stopped`). A running transport whose tick falls past the new end restarts there and
finishes at once, so playback stops. A load during playback therefore emits `playing`, never
`stopped`, unless the new score ends before the playhead.

Events:

- `state`: `'stopped' | 'counting-in' | 'playing' | 'paused'`, on every play, pause, stop and
  seek, when a count-in ends, and when playback reaches the end of the song.
- `position`: `{ position: PlaybackPosition, masterBarId, seconds, countingIn }` every frame
  while playing and once after every transport call. `seconds` is in the written tempo map
  (unscaled), so it can be fed back to `positionAtSeconds` for another track's `beatIndex`.
- `loop`: `{ pass, when }` each time the scheduler wraps the loop, `pass` counting from 1.

## Engine API

`createAudioEngine({ context, budgetBytes?, hqBudgetBytes?, scheduleMemory?, scheduler?, frames?, lookahead?, startLatency? })`
returns the `AudioEngine` contract of `docs/specs/architecture.md`. `context` is a context or a
factory; a factory is called on the first `unlock()`, `play()` or `previewNote()`, never in `load`,
so a song is decoded before the first gesture. `budgetBytes` is the memory manager's
(`GM_BUDGET_BYTES`, 80 MiB, by default) while `load` is given `tier: 'gm'`, and `hqBudgetBytes`
(`HQ_BUDGET_BYTES`, 300 MiB) is the "Memory for sounds" setting's initial value (see `setMemoryBudget`); `scheduleMemory` runs the coalesced
`memory` event (the next animation frame by default); the rest go to the transport.

| Object                                                                | Made                                                                   | Lives until                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| `ManagedSampleSource` (constructed `AudioBuffer`s) and `GmBank`       | `setSoundfont(font)`                                                   | `dispose`                                 |
| the `AudioContext`                                                    | construction (an instance) or the first unlock, play or preview        | `dispose`, which closes one it made       |
| `Sampler`, `ClickSynth` on its bus, the sampler sink, the `Transport` | with the context                                                       | `dispose`                                 |
| the sampler's tracks                                                  | a new song's load once live, or the unlock for a song loaded before it | `unload`, or an edit that drops the track |
| overrides and settings                                                | their setters, before or after the context                             | overrides and the loop: `unload`          |

| Method                                                                     | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setSoundfont(font)`                                                       | The parsed GM bank. Fetching it, and its errors, belong to the app. A second call throws; `load` before it rejects.                                                                                                                                                                                                                                                                                                                                                                            |
| `load(score, options)`                                                     | Resolves `{ instruments, fallbacks }`, the song plan's instruments and the assigned tracks whose pack failed to load (below), once the opening bars are decoded. A new song is `stopped` at tick 0. Over a loaded song it is an edit: the placement rule above, the overrides kept, the tracks synced; a timeline-neutral edit (`timelineNeutral`) reaches the strips and instruments at once, with no rebuild. Loading the same score object again decodes it again and changes nothing else. |
| `unload({ evict? })`                                                       | Stops, drops the song, its tracks, overrides, loop and instrument loads; `evict` frees every instrument too; without it the instruments stay resident, now `unused` (`unloadUnused` frees them), and the song's warm-up stops.                                                                                                                                                                                                                                                                 |
| `unlock()`                                                                 | Makes the context (and everything that needs it), applies the settings, attaches a loaded song; resumes a suspended context.                                                                                                                                                                                                                                                                                                                                                                   |
| `play`, `pause`, `stop`, `seek`                                            | The transport's. `play` unlocks first; the others are no-ops before the context.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `setTempo`, `setLoop`, `setCountIn`, `setMetronome`, `setMasterVolume`     | Validated, kept, and applied now or when the context is made. The master volume scales the bus, the metronome included.                                                                                                                                                                                                                                                                                                                                                                        |
| `startClick(settings?)`, `updateClick(settings)`, `stopClick()`, `click()` | The standalone click (below): a metronome with no score. `startClick` unlocks, pauses a playing song and starts; `play` stops it. Settings are validated (`RangeError`) and kept across stops.                                                                                                                                                                                                                                                                                                 |
| `setTrack(id, params)`                                                     | A user override over the track's channel, applied at once and kept through every baseline reset and edit until `unload`.                                                                                                                                                                                                                                                                                                                                                                       |
| `previewTrack(id, params)`                                                 | Volume or pan for a slider being dragged: no override, so the next baseline reset or edit replaces it.                                                                                                                                                                                                                                                                                                                                                                                         |
| `previewNote(track, note, options?)`                                       | One note through the track's strip, past mute and solo, stopped or playing. `note` is `{ string, fret }` (through the track's tuning and capo) or `{ pitch }`; `options` is `{ velocity?, seconds? }`; previews choke only previews. Throws with no song, and a `RangeError` for a track the song lacks.                                                                                                                                                                                       |
| `memory()`                                                                 | The memory manager's report; zero bytes against the budget before the bank.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `setMemoryBudget(bytes)`                                                   | The "Memory for sounds" setting: the effective budget is `bytes` on the HQ tier and `min(bytes, budgetBytes)` (80 MiB) on GM, reported by `memory().budgetBytes`. Lowering evicts at once; raising decodes the loaded song again if it all fits; `RangeError` for a non-finite or negative value; applied at `setSoundfont` if called before.                                                                                                                                                  |
| `unloadUnused()`                                                           | Frees the residents the open song does not plan (`memory().unused`; after `unload()`, all of them) and returns how many.                                                                                                                                                                                                                                                                                                                                                                       |
| `outputLatency()`                                                          | `baseLatency + outputLatency` of the context (`outputLatencyOf`), 0 before it.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `settled()`                                                                | Resolves with no load, instrument load or fetch in flight.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Events: the transport's `position`, `state` and `loop`; `memory` (the manager's, coalesced);
`instrumentLoads`, `{ [trackId]: { loaded, total } }` for each track whose new instrument is
decoding after a program edit, counted over that track's own samples, `{}` when done. A failed
decode rejects the `load` that started it.

**The channel baseline.** A beat's mixer change must not outlive the run it played in, so the
engine puts every strip back on its track's program and channel, with the user's overrides on
top, as each run starts, on every `stopped`, and at each loop wrap (scheduled at the wrap's time).

`debugAudioEngine(engine)`, from the test-only `@reprise/audio/testing` entry, returns the live
objects (`context`, `sampler`, `source`, `bank`, `transport`, and `assignments`, the loaded pack
assignments by track); it is not part of the contract.

### Pack assignments (#267)

`LoadOptions.packs` is a list of `PackAssignment`, `{ trackId, pack: { id, files }, entries }`:

- `pack.files` is an `SfzFiles` reader, the same object for as long as the installed version lives;
  a new object means the pack changed. `entries` maps articulation-set keys (`ARTICULATION_SETS`,
  below) to SFZ paths in the pack; `default` is required and is what plays, a key outside the list
  is ignored (listed in `debugAudioEngine(...).skippedEntries`), and the others are the sets a note
  can play (Articulation sets, below). Any change to `entries` loads the track again.
- `load` checks each assignment: the default SFZ must read, parse and map a region. One that does
  not goes to `LoadResult.fallbacks` (`{ trackId, packId, error }`), plays GM, and `load` still
  resolves. An assignment with the same pack id, files object and default path as the last `load`
  is not read again, whether it loaded or failed, so loading the same score with different `packs`
  checks only the tracks that changed, a broken pack is not retried on every edit (a reinstall
  brings a new files object), and an assignment that is gone is dropped.
- `tier` selects the memory budget on each `load`: the setting (`setMemoryBudget`) for `hq`, the
  smaller of it and `budgetBytes` for `gm`. Lowering it evicts at once, so going back to GM frees the pack buffers. The app passes
  `hq` when at least one assignment reaches the engine.
- A loaded assignment plays the pack: see "HQ tier in the engine" below.
- Root exports: `tierOf`, `checkPack`, `checkSfzFile` and the types `PackSnapshot`, `SnapshotFile`,
  `SfzFileCheck` (the installer's validation) and `LoadFallback`. `@reprise/audio/testing` adds
  `encodeWav`, `encodeFlac` and `syntheticSfzPack()`, a small valid pack in memory (`default.sfz`
  and `alt.sfz`, each over one WAV) that counts its reads, so tests commit no samples.

### HQ tier in the engine (WP-091 PR A)

- **One source, two providers.** `ManagedSampleSource` reads through a `ProviderRouter`
  (`samples/provider-router.ts`): a ref `sfz:<packId>/<path>` goes to that pack's `SfzPack`, anything
  else to the soundfont. A ref of a pack the router does not hold rejects `fetch` and has no owners.
  Accounting, LRU and pinning therefore cover the GM bank and every pack together, and the HQ budget
  counts pack buffers with no extra code.
- **Installs.** Every files object is an install, and sample refs and instrument ids carry it:
  `sfz:<packId>@<n>/<path>` and `sfz:<packId>@<n>:<sfzPath>`. A reinstall under the same pack id, a
  fetch of the old files still in flight and the buffers a removed pack left behind therefore never
  answer for the new files; the old install's buffers are an unplanned instrument and the next song
  switch evicts them.
- **Pack instruments.** The check that decides `fallbacks` parses `entries.default` once per
  (files object, path), shared by tracks and overlapping loads, and that parse is the instrument
  (`SfzPack.adopt`). `packInstrumentsOf(residents, packId)` names a pack's SFZ files from
  `memory().residents` for the memory screen (WP-094), whatever the install. `sound.instrument` is
  the caller's to map: the app picks the instrument's entries, so a different instrument of a pack
  arrives as a different `entries.default`, and the model's `instrument` change rebuilds the song.
- **One resolver.** `instrumentFor(track, program)` is the pack instrument for a track whose
  assignment loaded, whatever the program, else the GM preset. Attach, the baseline reset at each
  run, loop wrap and stop, the planner and the region maps all use it, and the sink's program
  changes leave an HQ track on its pack: the pack is the track's sound, as RSE is in Guitar Pro.
- **Order.** A `load` with an assignment it has not seen waits for the SFZ text before it attaches,
  so the router holds the pack before the first decode. A load that a newer load, or `unload`,
  overtook attaches nothing, before and after every wait. Until it attaches, `previewNote` ignores a
  track that is not in the sampler yet and `play` starts once the song is attached, never the
  previous one. With nothing new to read it stays synchronous.
- **Same score, other packs.** Only the tracks whose pack instrument changed are swapped
  (`setInstrument`) and decoded with `instrumentLoads` progress. An instrument no assignment names
  any more is freed by the next `load`'s song switch; the only leftovers are buffers of fetches
  that were already in flight.
- **Failure.** Only the samples the opening bars need (`DEFAULT_PRELOAD_BARS`) are checked at
  load. If that decode fails, each pack track's opening-bar samples are probed again (what decoded
  is resident, so only the failing ones are fetched) and the tracks whose pack cannot supply them
  go back to GM and into `fallbacks`. A sample missing from a later bar is not caught: the track
  stays on the pack and that note is skipped, as on any miss.
- **Not here.** The Sounds screen's setting and readout
  (WP-094 PR C).

### Known gaps

- Effects presets are not driven by CC91/CC93 (`channel.reverb`, `channel.chorus`) or a beat's
  `mix` reverb and chorus: the reverb send and chorus depth come from the preset only (#235).
- The memory setting has no screen yet: `setMemoryBudget` is applied from the persisted preference (`installTransport`), the status bar only reads `memory`, and the Sounds screen's control is WP-094 PR C.
- `previewNote` of a sample not yet decoded requests its decode (a miss) and starts the note when
  the sample is resident, unless that takes over 500 ms, when the note is dropped; a newer preview on the same string (or key), a stop, `removeTrack` or `dispose` cancels it. Previews choke only previews (#204).
- A load over a loaded song cuts the notes sounding at that moment and restarts after
  `startLatency`, as a seek does; only a timeline-neutral edit is seamless.
- `ChannelStrip.cancelAfter` holds a ramp's level with `cancelAndHoldAtTime`; Firefox lacks it,
  so there a ramp cut midway steps back to its start before gliding to its target.

## Timing guarantees

- Every event is handed out with `when >= currentTime`. An event the timer reached up to 50 ms
  late (a starved main thread) is moved to `currentTime` and shortened by the same amount; a
  later one is dropped rather than played out of time.
- Onsets are exact to the tempo map: the offline tests measure every onset of a four-bar score
  at 120 BPM at its expected sample, and through `RecordingSink` the times match to 1e-9 s.
  Through the real sampler (`transport-sampler.test.ts`) every onset lands at `when` plus the
  master bus's pre-delay, on the grid within 1 ms, and the metronome's clicks through the same
  bus carry the same delay to within 0.5 ms; a test that measures onsets behind the bus reads the
  delay off the first onset and subtracts it.
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
  anacrusis bar is aligned to the end of its bar, so a one-beat pickup clicks beat four. An
  over-full bar keeps clicking its time signature's beats until it ends, accented only on its first;
  an overflow beat that would end past the bar line is not clicked, so no click flams the next
  downbeat.
- **Loop start.** Pressing play outside the loop starts at the loop start, as Guitar Pro does.
  Seeking before the loop while playing plays from there into it. Seeking past its end, or setting
  a loop that is already behind the playhead, jumps to the loop start without counting a pass or
  firing `loop`: only a loop end reached by playing is a crossing.
- **End of song.** Playback stops when the clock passes the end of the last bar, so the last
  note sounds its full length, and returns to the start (or the loop start).
- **Tests run in Vitest browser mode on headless Chromium** (`../../docs/research/2026-11-05-vitest-web-audio-environment.md`):
  the real `OfflineAudioContext`, driven through `suspend` points so the scheduler's timer is
  simulated deterministically.

## Sampler

The sampler engine of [ADR-0004](../../docs/decisions/0004-own-sampler-engine-two-loaders.md),
in `src/sampler/`: region lookup, voice allocation and stealing, per-voice automation,
envelopes, loop points, channel strips and the master bus. It owns no sample data; buffers come
through a `SampleSource`, which is where the loaders (WP-032) and the memory manager (WP-034)
plug in.

### Graph

```text
 per voice
 AudioBufferSource -> Gain (ADSR) -> [BiquadFilter] -> BiquadFilter -> Gain (level) -> [StereoPanner] -> strip input
   playbackRate: key - rootKey + tune  Region.filter:   lowpass, open at    velocity or its    only when the
   detune: automation, semitones       cutoff moved by  Nyquist until an    modulators, region region pans
                                       modulators and   articulation        attenuation, dB
                                       the mod envelope closes it           automation

 per track (ChannelStrip)
 input -> Gain (mute/solo gate) -> insert.input -+-> direct (Gain 1) ---------+-> insert.output -> Gain (volume) -> StereoPanner -+-> master
 previewInput ---------------------^             \-> effects chain (below) --/                                                     \-> send (Gain) -> reverb bus -> master
                                                    (only while the track has one)                                (only with a reverb send)

 master bus (MasterBus)
 input -> DynamicsCompressor (limiter: -1 dBFS, ratio 20, knee 0) -> Gain (master)
       -> Gain (1/4) -> WaveShaper (soft ceiling) -> destination
```

The soft ceiling is the identity up to -1 dBFS and a tanh towards -0.2 dBFS above it, on an odd
curve (silence stays exactly 0) with no oversampling (no latency). The limiter's 1 ms attack lets
peaks through; the ceiling catches them, so the output never clips. There is no makeup gain:
levels come from the soundfont's own gains. An SF2 loader scales `initialAttenuation` by 0.4 as
FluidSynth does, since soundfonts such as GeneralUser GS are voiced for it (#169; the decision is recorded in ADR-0027);
`test/loudness.test.ts` pins the resulting levels.

### Contracts for the loaders and the memory manager

```ts
type SampleRef = string; // opaque; only the SampleSource that issued it resolves it

interface Envelope {
  delay?: number; // silence before the attack while the sample already runs; 0 when absent
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
}
// seconds; sustain is a linear 0..1 gain (an SF2 loader converts its centibels)

interface Region {
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number; // inclusive, 0..127
  rootKey: number; // MIDI note the sample sounds at
  tune: number; // cents
  sample: SampleRef;
  loop?: { start: number; end: number; unit?: 'frames' }; // seconds into the decoded buffer; unit 'frames' (SFZ) is frames at the buffer's own rate, which the voice divides by buffer.sampleRate
  envelope: Envelope;
  layer?: string; // articulation layer; absent = default
  attenuation?: number; // dB, positive is quieter: SF2's sign; an SFZ loader negates its `volume`; the SF2 loader scales initialAttenuation by 0.4 as FluidSynth does
  pan?: number; // -1..1, for a mono sample; absent or 0 adds no panner to the voice
  filter?: {
    cutoffHz: number;
    q: number;
    envelope?: { cents; delay; attack; hold; decay; sustain };
  }; // low-pass from the note's start: cutoffHz at rest, an optional modulation envelope sweeps it by `cents` (delay, attack, hold, decay to `sustain`; release not modelled); q in dB, Web Audio's lowpass unit
  modulators?: NoteModulator[]; // SF2 note-on modulators (velocity and key sources; attenuation, cutoff, envelope depth and Q), evaluated once per note; with them the velocity curve is theirs, without it is (v/127)^2
  exclusiveClass?: number; // a new note of the class chokes the sounding ones on the track's instrument; reads as group = offBy = c
  // The SFZ fields (#194). All optional; an SF2 region never sets them.
  startFrame?: number; // SFZ offset, frames at the buffer's rate, added to the request's offset (seconds)
  oneShot?: boolean; // note-off is ignored and the sample plays to its end; allNotesOff still stops it
  velocityTrack?: number; // 0..1: gain = velocityGain(v) ** velocityTrack, on the path without modulators
  group?: number; // a new note of this group chokes the voices whose offBy equals it
  offBy?: number; // one-way: a closed hi-hat (group 2) cuts the open one (off_by 2), not the reverse
  trigger?: 'release' | 'first' | 'legato'; // absent plays at note-on; a release region plays at the note-off (resolveRelease, VoiceHandle.release)
  releaseDecay?: number; // SFZ rt_decay, release regions only: dB of attenuation per second the note was held
  sequence?: { length: number; position: number }; // round robin, position 1-based
  random?: { lo: number; hi: number }; // 0..1, lo inclusive, hi exclusive
}

class RegionMap {
  constructor(regions: readonly Region[]);
  resolveAll(key: number, velocity: number, layer?: string, select?: RegionSelection): Region[]; // every layer of the note
  resolveRelease(key: number, velocity: number, layer?: string, select?: RegionSelection): Region[]; // the release regions a note-off starts
  candidates(key: number, velocity: number, layer?: string): Region[]; // every region the note could start or release, all round-robin and random positions
  resolve(key: number, velocity: number, layer?: string): Region | undefined; // resolveAll's first
  readonly layers: string[];
}

interface RegionSelection {
  sequence?: number; // notes of this key so far; a sequence region plays when (sequence % length) + 1 is its position
  random?: number; // 0..1 draw; a random region plays when lo <= random < hi
  legato?: boolean; // the note starts over a sounding one: legato regions play, first regions do not
}

interface SampleSource {
  getBuffer(ref: SampleRef): Promise<AudioBuffer>; // fetch and decode when needed
  peekBuffer(ref: SampleRef): AudioBuffer | undefined; // resident now, no loading; every scheduled note calls it
}

interface Instrument {
  regions: RegionMap;
  source: SampleSource;
}
```

`resolveRelease` returns the release regions of a note-off, with the same layer fallback and the
same `select` counters (a sequence or random release region plays only when it passes), but with
no nearest-region fallback: key and velocity match exactly, so a note-off outside every release
region is silent. A release region is limited by `lokey`/`hikey` or `lovel`/`hivel` on purpose (noise
only on loud notes, say), a transposed release sample sounds wrong, and in SFZ a note-off with no
release region plays nothing; the attack fallback exists so that a note always sounds, which does
not carry over to a decorative tail. `candidates` includes only the release regions a note-off can
trigger, since one has to be resident at the note-off and nothing else would use it.
`RegionMap.hasReleaseRegions` is true when any region triggers on release; a map without them
(every SF2 preset) skips `resolveRelease` altogether, so a General MIDI note pays nothing for it.
`RegionMap.hasLegatoRegions` is true when any region plays only on a hammer-on or pull-off
(`trigger=legato`), in any layer; `hasLegatoRegionsIn(layer)` asks about one layer, with the
default layer as the fallback, as `resolveAll` does.

`resolveAll` first filters out the regions that do not start at note-on: release regions never do,
`first` regions play unless `select.legato`, `legato` regions only with it, a sequence region plays
when `((select.sequence ?? 0) % length) + 1` is its position and a random region when
`lo <= (select.random ?? 0) < hi`. Without counters the choice is the first take (position 1, the
bucket holding 0, no legato) rather than layering every round robin at once, until a caller passes
`NoteOnRequest.select`; the sampler sink does. The nearest-region fallback searches only the regions that pass. `candidates` is the
unfiltered-by-counter set that `planSamples` and `Sampler.preload` use, so the round robins the sink
rotates through are resident before it does; on an SF2 map it equals `resolveAll`. `resolveAll` then
returns every exact match in map order, since an SF2 preset layers zones by design (a
body and an attack, two panned mono samples) and sounds them all; failing any, the one region
nearest by key and then by velocity, so a pack that stops short of a drop tuning still sounds. A layer the map lacks
falls back to the default layer (and a map with no default layer uses its only one), which is
ADR-0004's filter-and-envelope path for articulations without samples. `SynthSampleSource` is the
in-memory source for tests: sines and seeded noise, synthesized on first use, optionally
`deferred` to behave like a real loader.

**What the sampler tells the source.** `peekBuffer` is called for every note the sampler starts
and is the only use signal there is: a memory manager keyed on last scheduled use counts those
calls. `getBuffer` is called on a miss (fire-and-forget, so the sample is resident next time) and
from `preload`.

**SF2 generators the shape does not carry**, and what the loader does with them: `sampleModes` 3
(loop until release) becomes a plain `loop`, since the release envelope covers the tail and
`AudioBufferSourceNode.loop` cannot be switched off sample-accurately; `delayVolEnv` becomes
`Envelope.delay`; the filter and its modulation envelope become `Region.filter` (the voice plays the envelope over time); `initialAttenuation` is scaled by 0.4 as FluidSynth does, and the note-on modulators become `Region.modulators`; the stereo zones of a sample pair (ruling on this PR) are merged into one two-channel
buffer, which the voice graph passes through unchanged; a mono zone's `pan` goes to `Region.pan`;
`keynumToVolEnvHold` and `keynumToVolEnvDecay` ride on `Envelope` as `holdPerKey` and `decayPerKey` (timecents per key) and the voice scales the hold and decay for the struck key at note-on (see
[SF2 loader and GM tier](#sf2-loader-and-gm-tier), which has the full mapping).

### Sampler API

```ts
const sampler = new Sampler(context, { polyphony: 64 });
sampler.addTrack(track, instrument); // a strip per track, from track.channel
sampler.setInstrument(trackId, instrument, at); // a program change: notes from `at` on play it; no `at` is now
sampler.instrumentAt(trackId, when); // the instrument a note starting at `when` plays
sampler.setTrack(trackId, { volume, pan, mute, solo }); // AudioEngine.setTrack, 0..127 units
sampler.setTrack(trackId, { volume }, { at, ramp }); // a scheduled mixer change: at `at`, gliding over `ramp` s
const voice = sampler.noteOn(trackId, {
  key,
  velocity,
  when,
  string,
  layer,
  offset,
  letRing,
  instrument,
  select, // { sequence?, random?, legato? }: chooses the round-robin and random takes, for the note and its release regions
  releaseTrigger, // default true; false: this note's release starts no release regions (see Release triggers)
});
voice?.rampDetune(2, when + 0.2); // semitones, absolute times
voice?.setGain(-6, when + 0.1); // dB relative to the velocity level
voice?.setFilter({ frequency: 1200, q: 1 }, when); // the articulation filter, after Region.filter
sampler.noteOff(voice, when + 0.5); // ignored for let-ring voices
sampler.previewNote(trackId, { string, fret } /* or { pitch } */, { velocity, seconds }); // now, through the strip past its mute gate; waits up to 500 ms on a decode
await sampler.preload(trackId, [{ key, velocity }]);
```

`noteOn` starts a voice per region `resolveAll` returns and hands back one handle for all of them:
detune, gain, filter and release reach every layer, and `endTime` is the last one's.

**Release triggers.** `handle.release(at)`, and the let-ring `until` release, also start the note's
release regions (`resolveRelease`, with the note's own `layer` and `select`) at `at`, once however
often the handle is released. They never start on a choke, a steal, `allNotesOff` or a preview,
and a note already cut short by one of them has none. A release voice is a one-shot, so a later
release does not cut it, and it carries string 0, so the next note on the string, which normally
starts at the previous note's release, does not choke it.

The release voices belong to their note. The sink calls `release` at scheduling time, so a tail can
exist seconds before it starts (a let-ring note's waits for the bar end); a choke or steal of the
note at `t` cancels its tails that have not started by `t` (they never sound), while one already
sounding plays out. A release voice never steals: when the pool is full at its start it is skipped
and counted (`Sampler.skippedReleases`), since release noise is decoration. It is also the first
voice a later note steals (a waiting one is cancelled, a sounding one fades), so it holds a slot from the
note-on, but the first one a later note takes. Otherwise it counts in the polyphony like any voice, `allNotesOff` still stops
it (one waiting to start never sounds), and `Region.releaseDecay`
(`rt_decay`) lowers it by that many dB for each second the note was held. A release sample that is
not resident is a miss like any other: skipped, its load requested, `onMiss` told.

`NoteOnRequest.releaseTrigger` (default true) lets a caller keep a strike from firing them. A
release region is meant for the note's final release, but the sink releases every strike and the
string is never let go between a tremolo's strokes, a trill's alternations or a grace note and its
main note, so each would play a release sample (at nearly full level with a high `rt_decay`). The
sink therefore sets `releaseTrigger` true only on the last strike of the main note: that covers the
end of a legato chain (the chain's first voice carries the release) and the let-ring `until`, and
it sets it false on earlier strikes and on every grace note. It is also false on a note whose
next note on the string is a hammer-on or pull-off starting at its release (a let-ring note's is
the ring's end), unless the hammered note has a grace note on its beat: the string is not let go
there, so the chain plays one release sample, at the last note's release, not one per note. A note
with no release regions gets the plain voice handle as before, so GM playback is unchanged.

`createSamplerSink(sampler, { deadNote?, instrumentOf?, voicingFor? })` is the scheduler's `InstrumentSink` over the sampler,
with the articulation layer described under [Articulations](#articulations). Every strike also
carries `NoteOnRequest.select`: `sequence` counts the notes struck so far per track, region map, layer
and key (a stop, pause or seek starts it over, so a repeat from the same start rotates the same way),
`random` is a hash of the note's id, its pass of the sequence and the strike's index (no
`Math.random`, so an offline render repeats exactly), and `legato` is set on a hammer-on or
pull-off when `voicingFor(track)` says the track's default map has `trigger=legato` regions. A track
with no voicing, every General MIDI track, plays as before. The counter is per key and layer, not
per region as in sfizz (which advances one counter per region on every note-on in its key range,
so a scale run inside one multi-key region rotates its takes; here each new key starts at take 1).
Per key is deliberate: the takes of a keyswitched pack are recorded per pitch, and the layer is
part of the slot so that alternating palm-mute and sustain strikes on one key do not share a
counter, which with two takes each would give every palm-mute strike one take and every sustain
strike the other. Each event becomes
attacks, pitch and level automation, a filter and a release; `allNotesOff(when)` releases every
voice, the ones scheduled after `when` included (a release before a voice's start time is a 0-to-0
fade, so it never sounds), forgets any legato slide waiting for its next note, and drops the
program changes and the strips' volume and pan changes scheduled after `when` (the scheduler
sends each again when playback reaches its beat, so a stop, pause or seek inside the lookahead
never lands a later change early, or over the baseline a stop restores). A
`MixEvent`'s `mix.program` switches the track's instrument at the beat through `setInstrument`, to what
`instrumentOf(track, program)` returns (the caller's region map and source for that program;
`undefined` keeps the current one), the same playback-order attribution the memory planner uses.

`noteOn`'s `instrument` plays a region of another instrument through the track's strip: the dead
note's noise burst uses it, so it works whichever tier the track is on. `previewNote` joins the
strip after its mute gate, so a note clicked in the editor sounds on a muted track and beside a
soloed one; it still goes through the insert, the fader and the panner.

### Decisions

- **Doubled courses (#348).** `NoteOnRequest.course` is the semitone offset of a course's second
  string; the sink sets it from `courseOffset(track, string)` for every strike except a dead or
  ghost note, and `previewNote` does the same. `noteOn` starts the partner's voices in the same
  call as the first string's, behind the one handle, so the partner never chokes its sibling (the
  choke runs before either starts), the next note on the string chokes both, and every detune,
  gain and release call, a bend or a slide included, reaches both. The partner sounds the key plus
  the offset with a fixed detune and level trim (`COURSE_PARTNER`: an octave string +3 cents and
  -4 dB, a unison one -3 cents and -3 dB), folded into its playback rate and base level, not into
  automation, so a bend curve stacks on them. No randomness: a render repeats. A partner whose
  sample is not resident is skipped alone. Release samples play once, for the first string. A
  12-string keeps its own program, and GM and packs double alike, because the doubling is the
  engine's. `courses.bench.ts` measures it: eight strummed tracks cost about 1.7 times the voices
  and time when doubled.
- **The Mandolin variation.** `GmBank` plays GeneralUser's Mandolin (bank 16, program 25) for a
  mandolin on program 25 in bank 0, chosen at play time and never stored in `Track.bank` (#411);
  a soundfont without it falls back to program 25 in bank 0.
- **Two gains per voice.** The envelope and the articulation automation (dB) live on separate
  `GainNode`s, so a gain ramp from an articulation never cancels the ADSR, and the release can
  `cancelAndHoldAtTime` the envelope alone. The plan's order (source, gain, filter) holds; the
  level gain after the filter is the extra node.
- **Pitch** is split: `playbackRate` carries the key shift and region tune, fixed per voice;
  `detune` starts at 0 and carries only automation, so bend and vibrato curves are relative to
  the written note. The voice sets no initial `detune` value: Chromium skips a value curve
  (`setValueCurveAtTime`) that starts mid-quantum after any event in the same 128-frame render
  quantum (a `setValueAtTime` at the same time or up to a quantum earlier, a `setTargetAtTime`), so
  a curve from the note's onset never played. A quantum-aligned start plays, a curve after a curve
  plays, and an event scheduled inside a curve's span throws `NotSupportedError`; so a curve is
  always a voice's first detune event, a chained note's events start after the previous curve
  ends, and `rampDetune`, which anchors at the onset lazily, cannot precede a curve from the onset
  on one voice. Measured on a rendered 440 Hz sine by interpolated zero crossings, every case in
  the test lands within 0.001 cent of the target.
- **Envelope shapes.** Linear attack, exponential decay and release (aimed at -80 dB, then set
  to 0 and the source stopped), so the release reaches exact silence. Chromium's
  `cancelAndHoldAtTime` holds nothing when no ramp spans the release time, so the release also
  sets the analytic envelope value at that time to anchor the fade.
- **One-shot is honored in `Voice.release`, not only in `Sampler.noteOff`.** The sink releases
  handles directly at each note's end, so a guard in `noteOff` alone would never fire. `Voice.stop`
  releases regardless, and `allNotesOff` uses it, so stop and seek still silence a drum tail.
- **`previewNote` and one-shots.** A one-shot ignores the preview's timed release too, so clicking
  one in the editor plays the whole sample.
- **`velocityTrack` is a power of the MIDI curve.** `velocityGain(v) ** t` scales the dB curve, one
  reading of sfzformat.com. sfizz blends linearly in amplitude instead (`1 - t * (1 - (v/127)^2)`);
  for `amp_veltrack=73` at velocity 30 that is about -18 dB here against about -10 dB there. No
  listening check against a real pack has been done, so the choice is open (see the SFZ section).
- **SFZ loads are capped** (`LIMITS` in `sfz/report.ts`), because pack files are untrusted: 256
  files read per load (the root and every include), 4,000,000 characters of preprocessed text, 65,536
  characters in one `#define` value, 100,000 regions after `pitch_keytrack` expansion and keyswitch
  layer copies. A cap stops the expansion cleanly, adds an entry to `report.limits` (so `isClean` is
  false) and returns what was parsed; only an unreadable root file throws. Numeric opcodes are
  clamped to their SFZ range and counted in `report.clamped`, and paths with percent-encoded
  separators or dots, control characters or Windows device names are refused like escaping paths.
  `SfzReader` receives literal, root-relative paths and must not decode or symlink-follow them.
- **SFZ choke is one-way.** A new note's groups are `region.group ?? region.exclusiveClass ?? 0`; it
  chokes voices whose `offBy ?? exclusiveClass ?? 0` is among them (0 is none). For SF2 that is
  today's same-class choke; for SFZ, closed cuts open and open does not cut closed.
- **Stealing** is released voices and release-region tails first, then the quietest at the new note's time, then the
  oldest. Quietest is what the voice plays: envelope × velocity × the articulation gain automation
  (a palm mute's -18 dB, a fade-in from -48 dB), all computed analytically. A note that has not
  started yet, or starts with the new one (its own layers, a chord), is stolen only when every
  other voice is gone, the quietest at its onset first, so `polyphony` is a hard cap: a
  three-note chord at polyphony 2 keeps its two louder notes. The stolen
  voice fades over 5 ms from its level at that moment, release in progress included, and no longer
  counts against the limit. Each layer of a note is a voice of its own and counts as one; a layer
  inside its envelope delay ranks by the level it is about to sound at, not as silent.
- **Strings choke.** A new note on a string damps whatever sounds on that string, let-ring or
  not, with a dedicated 15 ms fade (`CHOKE_FADE`) rather than the region's release, which on a
  sampled guitar is long enough to smear the next note; string 0 (drum and pitched tracks)
  never chokes. A let-ring voice ignores note-off and rings to the next note on its string or to
  `letRing.until`, the end of the bar the scheduler supplies.
- **Exclusive classes choke the same way.** A note whose regions carry an `exclusiveClass` damps,
  with the same 15 ms fade, every sounding voice of that class on the track that came from the same
  region map, which is how a GM kit's closed hi-hat cuts the open one. A region of another
  instrument played through the track (the dead note) is not in the class.
- **Region filter and envelope delay.** `Region.filter` is a low-pass node of its own ahead of the
  articulation filter, set at the note's start, so a palm mute's 900 Hz adds to a GM zone's cutoff
  and a harmonic's shelf, which switches the articulation filter's type, keeps it. `Envelope.delay`
  holds the envelope at 0 from the onset while the source already runs, as SF2 does, so the sample
  enters partway through; `levelAt` reads 0 until then.
- **A non-resident sample is a skipped note, not a late one.** A scheduled note cannot wait for a
  decode; `noteOn` returns `undefined`, requests the load and reports through `onMiss`. Playback
  start pre-warms with `preload` (ADR-0005), which loads every layer. A layered note with some
  layers resident plays those and reports each missing one, so `Sampler.misses` counts missing
  samples, one per layer, not notes.
- **Channel units.** `setTrack` takes the model's 0..127 volume and pan; volume follows the MIDI
  curve `(v / 127)^2`, pan 64 is centre. `ChannelStrip.set(settings, at?, ramp?)` takes linear gain
  and -1..1 pan; without `at` a change is smoothed in now, with it the change lands at `at`, as a
  linear glide over `ramp` seconds or a 5 ms smoothed step. `ChannelStrip.gain` and `.pan` report
  the last value set, so a change scheduled for `at` reads as its target from the call on, before
  it lands.
- **The limiter is Chromium's compressor**, which is not transparent: it applies automatic makeup
  gain (about +0.5 dB at these settings), its detector takes the first 100 ms or so of a render to
  settle, and it has a fixed pre-delay, measured at 264 frames (5.99 ms at 44.1 kHz): everything
  through the master bus lands that much after its `when`. Tests that compare levels play below
  the threshold and measure after that; a test that measures onsets must tap before the bus.

## Effects chain

WP-092. The strip's insert (between `insert.input` and `insert.output`) holds a chain that exists
only while the track resolves to a preset with an insert stage; a track without one is the
direct connection and nothing else, which is bit-identical to a strip with no effects code.
`src/effects/` holds it; the pure tables are root exports, the node classes stay internal.

```text
insert.input -+-> direct (Gain 1) ----------------------------------------------------+-> insert.output
              \-> input -> drive -> tone -> cabinet -> modulation -> delay -> output --/
                  (each a BypassSlot: a dry connection beside the stage's own nodes)

strip, after the fader and the panner: send (Gain) -> shared ReverbBus (a convolver) -> master.input
```

| Stage        | Nodes                                                                                                                                                                | Channels |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `input`      | Gain (pre-drive level)                                                                                                                                               | mono     |
| `drive`      | Gain (1/4), WaveShaper (curve `clean`, `overdrive`, `distortion`, `fuzz`; oversample none, 2x, 4x, 4x), 25 Hz highpass                                               | mono     |
| `tone`       | three biquads: lowshelf 120 Hz, peaking 750 Hz, highshelf 3.2 kHz                                                                                                    | mono     |
| `cabinet`    | Convolver (`disableNormalization`, a generated 46 ms cabinet)                                                                                                        | mono     |
| `modulation` | chorus: two Delays (15 ms) swung by one Oscillator (0.8 Hz), the sides in antiphase, wet/dry mix; the head is explicitly stereo, so a mono source reaches both sides | stereo   |
| `delay`      | Delay (up to 1.5 s), feedback Gain (at most 0.6) through a 4 kHz lowpass, wet mix                                                                                    | stereo   |
| `output`     | Gain (the preset's makeup)                                                                                                                                           | stereo   |
| `reverb`     | the strip's send Gain into the shared bus                                                                                                                            | stereo   |

An amp is mono: `input` to `cabinet` take the sum of the channels (`channelCountMode: 'explicit'`),
and a bypassed amp stage keeps a stereo sample stereo, because the dry connection is stereo.

### Presets, and which one a track gets

Ten ids: the eight families, `fuzz` and `off`. `presetFamilyOf(track)` reads `kind` first (drums),
then the GM program: 29 `overdrive`, 30 `distortion`, 24 and 25 `acoustic`, 26 to 28 and 31
`clean`, 32 to 39 `bass`, 0 to 23 `keys`, the rest `other`. `EFFECT_PRESETS` holds the stage
values (an absent stage is bypassed): `clean`, `overdrive`, `distortion` and `fuzz` have the amp
stages and a cabinet; `clean` a chorus, `overdrive` a delay; `acoustic` and `bass` only a tone
stack; `keys`, `drums` and `other` only a reverb send; `off` nothing.

`resolveEffects(track, { tier, gmTierBypass })` gives `{ preset, automatic }`:

| `sound.preset`               | Tier | GM tier bypass | Result                            |
| ---------------------------- | ---- | -------------- | --------------------------------- |
| a known id (including `off`) | any  | any            | that preset                       |
| absent or unknown            | hq   | any            | the family preset                 |
| absent or unknown            | gm   | on (default)   | no chain, the GM tier's own sound |
| absent or unknown            | gm   | off            | the family preset                 |

So the bypass governs automatic presets on GM tracks only: a preset the user picks applies on
either tier. The exported `tierOf(track, packs)` is `hq` when an assignment names the track, `gm`
otherwise, and the engine applies it to the assignments that loaded; a track that names a pack in
`sound.packId` only (not installed, failed) is `gm`. `setGmTierBypass(on)` re-resolves every
track; and `setStageBypass(trackId, stage, bypassed)` is a session override like `setTrack` (not
saved, kept through edits, cleared by `unload`); the reverb stage's bypass is its send at 0. A
`sound` edit that changes only `preset` is timeline-neutral (`timelineNeutral`), so it and its undo
are heard at once with no rebuild; a `packId` or `instrument` change is not.

### Switching, bypass and idle paths

- One primitive, `BypassSlot`: a dry connection that is always there, and processing paths
  beside it. A switch is a 20 ms equal-power crossfade (a quarter sine in, a quarter cosine out,
  ten straight segments that land exactly on 0 and 1; a reversal mid-fade restarts from the
  interpolated value). Equal power, because the paths of a preset change are partly correlated:
  a straight crossfade dipped 5 dB between `clean` and `overdrive` at its middle, and two
  correlated paths sum to at most the square root of two. When the fade ends the idle side is
  disconnected, so a bypassed slot is a single gain-1 connection and its nodes cost nothing.
  A slot is made for each stage and for the strip.
- A fully bypassed chain is structural: the chain is disposed, `insert.input -> direct ->
insert.output` is all that is left, and the rendered samples are bit-identical to a strip that
  never had effects, the sign of zero included.
- A change of one stage (on, off, another curve or cabinet) crossfades that stage alone, ducking
  through its dry connection: the new path is built when the old one has faded out. A change of
  more than one stage is a preset change: the strip builds the new chain (inside the slot's
  build step, so one that is replaced first is never made) and crosses over from the old chain
  to it directly, the dry connection staying out of it. Going through dry put the raw GM signal
  between two cabinet-filtered ones and doubled the time. Continuous parameters (gains, tone
  gains, delay time, feedback, mix) are smoothed in place with the strip's 5 ms constant (50 ms
  for a delay time).
- The idle path is disconnected from a timer (`defer`, a poll of the context's clock; a test
  injects its own and flushes it from `suspend`).

### Reverb: one shared bus (a departure from the work package)

The work package lists reverb among the inserts. A convolver per track would multiply the one long
convolution (1.4 s, stereo) by the track count: measured offline over two runs, 8 tracks with a reverb
each cost 2.1 to 2.8 times as much as the same chains sharing one bus (1.5 to 2.0 s against 0.72 s
for 10 s of audio), 16 tracks 2.7 to 3.5 times (3.4 to 4.4 s against 1.26 s). On CI (run 43775156445) the ratio was 1.9
at 8 tracks and 2.0 at 16. So each strip has a post-fader, post-pan send into one `ReverbBus`, whose return
joins the master bus, and a track's "reverb stage" is its send level. The fader scales the send
and the mute gate is before everything, so a muted track sends nothing. The bus is made on the
first send and lives until `dispose`.

### Impulse responses: generated, not shipped

`src/effects/impulses.ts` generates every impulse at runtime, at the context's sample rate (a
`ConvolverNode` refuses another rate), from fixed seeds (mulberry32): nothing is committed,
fetched or taken from a recording, so there is no third-party material and no licence entry. The
cabinets (`open-1x12`, `closed-2x12`, `closed-4x12`) are a unit impulse through an RBJ biquad
cascade (highpass, cone resonance, presence peak, two notches, a sixth-order lowpass), cut at 46 ms
with a half-Hann fade, normalised to unit energy. The room is stereo, 1.4 s, with a 10 ms
pre-delay, twelve early taps and a two-band noise tail (RT60 about 0.9 s lows, 0.5 s highs), the
channels on independent seeds. `ImpulseBank` makes them on first use and keeps the `AudioBuffer`s:
about 0.5 MB for the room and 24 KB a cabinet at 44.1 kHz, under 2 MB for all of them at 48 kHz.
They are not sample memory and stay out of `MemoryReport.decodedBytes`.

### Measured (`effects/*.test.ts`)

A 220 Hz sine at -12 dBFS through a strip (the reverb return left out), harmonics 2 to 8 by
`toneLevel` over 0.25 to 0.75 s. The tests' thresholds are set from these values with margin:

| Preset       | THD (2 to 8) | 2f / f | RMS against bypass, forte (-26 dBFS) / mezzo (-31) |
| ------------ | ------------ | ------ | -------------------------------------------------- |
| bypassed     | under 1e-6   | 0      | 0 dB                                               |
| `clean`      | 0.010        | 0      | +0.1 / +0.2 dB                                     |
| `overdrive`  | 0.15         | 0.0001 | -0.3 / +0.3 dB                                     |
| `distortion` | 0.31         | 0      | about -2.2 / +2.2 dB                               |
| `fuzz`       | 0.43         | 0.016  | about -2.1 / +2.1 dB                               |

The level match is calibrated on a plucked line (harmonics at 1/k, a new pitch every half second)
at **forte, -26 dBFS RMS**, which is about a forte GM note (`loudness.test.ts`: a steel note peaks
near -18 dBFS), and checked at mezzo, -31 (velocity 96 against 127). A saturating preset puts out
nearly the same level whatever it is fed (about 0.9 dB per dB), so the amp presets' `output.gainDb`
sits midway between the two levels: they are 2 dB under bypass at forte and 2 dB over at mezzo,
and wherever a note is much quieter than mezzo they get louder than bypass (about 8 dB over at
-42 dBFS). Their peaks stay bounded, about -11 dBFS per strip at the hottest input, so one track
cannot reach the master ceiling.

The bench (`effects/effects.bench.ts`) renders 5 s offline of 16 tracks, each with a three-note
chord every 1.25 s: 0.64 s with distortion chains and the shared reverb (the budgeted row of the
roadmap, 1 000 ms), 0.27 s with no chain (Apple M4 Pro, headless Chromium).

### Known limits

- A saturating preset aliases on high notes: with the tone and cabinet stages out, `distortion`
  puts energy 37 dB under the fundamental at 1760 Hz and `fuzz` 27 dB under (a curve with no
  memory fed a pure sine can only fold harmonics below it). `WaveShaperNode` oversamples at most
  4x, which `distortion` and `fuzz` use; `overdrive` uses 2x and `clean` none, its THD being 1%.
  The cabinet's lowpass cannot remove what folded below the fundamental. A gentle lowpass ahead
  of the shaper would, at the price of the tone; left for the ear.

## SF2 loader and GM tier

In `src/sf2/`: a SoundFont 2 parser, the resolution of presets into `Region`s, and
`Sf2Soundfont`, which implements the memory manager's `SampleProvider` seam over one bank.

```ts
const font = Sf2Soundfont.parse(bytes); // headers only; the PCM stays in `bytes`
font.regionMapFor(bank, program); // RegionMap | undefined; the bank falls back to 0
font.drumKitRegionMap(kit); // bank 128; a missing kit falls back to kit 0
font.preset(bank, program); // exact: { id, name, regions, bytes, report }
font.instrumentsOf(ref); // ['gm:0:48', 'gm:0:49', ...]: every preset playing the slice
font.byteLength(ref); // decoded Float32 size, before any fetch
await font.fetch(ref); // { sampleRate, channels: Float32Array[], byteLength }
```

**Our own parser, not a library.** The candidates were `soundfont2` (MIT, last released in
October 2024) and SpessaSynth's parser, which ADR-0004 already set aside. Neither resolves
generators into the shape the `Region` needs, so that layer, the bulk of the work, would be ours
either way; what remains is the RIFF walk plus fixed-size records, and owning it keeps the PCM a
view over the file until `fetch`, with no dependency to audit. It reads `INFO`, `sdta` (`smpl` and, from version 2.04,
`sm24`) and `pdta`'s nine sub-chunks, uses only `DataView` and `TextDecoder`, so it runs in Node
as well, and builds no `AudioBuffer`: decoding into one is the memory manager's job. Every count
it allocates is bounded by the chunk that holds it, and a malformed file fails with an
`Sf2ParseError` (fuzzed over byte flips, truncation and corrupted chunk sizes).

**Lazy decode.** Parsing records where each sample's PCM sits; nothing is converted. `fetch`
converts one slice of 16-bit PCM (with the `sm24` low byte when present) to Float32 channels. A
sample ref carries everything `fetch` needs, so the provider keeps no table of issued refs:
`<soundfont>/<shdr index>[+<right index>]/<start>-<end>`, absolute frames into `smpl` after the
zone's address offsets. The ref is the PCM span alone: the loop lives on the `Region`, in seconds
of that span, and the tuning and envelope with it, so every zone of every preset that plays the
same span shares one ref and the memory manager decodes it once. `instrumentsOf` names every
preset of the bank that plays a slice; its index is built on first use from the instruments'
zones, which a preset cannot change, so it costs a few milliseconds and under a megabyte for a
whole GM bank rather than resolving every preset.

**Resolution.** An instrument's zones are resolved once and shared by every preset that names
it: within each level a local zone's generators replace its global zone's, and the zone's sample,
addresses, loop and stereo partner are fixed there. Per preset, the preset zone's values are
added to the instrument's as offsets, the sum clamped to the spec's range; key and velocity ranges
intersect instead, and the generators the spec reserves for instruments (addresses,
`sampleModes`, `exclusiveClass`, `overridingRootKey`, `keynum`, `velocity`) are ignored at
preset level.

| SF2 generator                                                                             | `Region`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keyRange`, `velRange`                                                                    | `keyLo`..`keyHi`, `velLo`..`velHi`: the instrument zone's range intersected with the preset zone's; an empty intersection drops the zone                                                                                                                                                                                                                                                                                                                                                        |
| `overridingRootKey`, else `shdr.originalPitch`                                            | `rootKey`; an `originalPitch` of 255 (unpitched) reads as 60                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `coarseTune`, `fineTune`, `shdr.pitchCorrection`                                          | `tune` = coarse × 100 + fine + correction, in cents                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `modEnvToPitch`, `sustainModEnv`                                                          | `tune` += depth × (1000 − sustain) / 1000: the pitch the modulation envelope holds after its transient is a fixed offset (GeneralUser GS tunes its Ocarina with it)                                                                                                                                                                                                                                                                                                                             |
| `scaleTuning` ≠ 100                                                                       | one region per key, `rootKey` = key, `tune` = scale × (key − root) + the cents above: exact                                                                                                                                                                                                                                                                                                                                                                                                     |
| `sampleModes` 1 and 3                                                                     | `loop`, in seconds from the slice start; 3 (loop until release) as a plain loop. 0 and 2 play once                                                                                                                                                                                                                                                                                                                                                                                              |
| address offsets (`start`, `end`, `startloop`, `endloop`, fine + 32768 × coarse)           | the slice the ref names and the loop inside it; a loop starting before the start offset cannot live in the slice and is dropped (reported)                                                                                                                                                                                                                                                                                                                                                      |
| `attackVolEnv`, `holdVolEnv`                                                              | `envelope.attack`, `.hold`: 2^(timecents / 1200) seconds                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `sustainVolEnv`                                                                           | `envelope.sustain` = 10^(−cB / 200); 1000 cB (100 dB) and more is 0                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `decayVolEnv`                                                                             | `envelope.decay` = SF2 time × min(sustain dB, 80) / 100: SF2 times a full 100 dB fall at a constant dB rate, the sampler the fall to the sustain level, or -80 dB at most                                                                                                                                                                                                                                                                                                                       |
| `releaseVolEnv`                                                                           | `envelope.release` = SF2 time × 80 / 100, the sampler's release ending at -80 dB; exact from full level, slower from a lower one                                                                                                                                                                                                                                                                                                                                                                |
| `delayVolEnv`                                                                             | `envelope.delay`, seconds, when above the spec's 1 ms default                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `initialFilterFc`, `initialFilterQ`, `modEnvToFilterFc`, `*ModEnv` times, `sustainModEnv` | `filter.cutoffHz` = fc at rest, clamped to 1500 to 13500 cents (20 Hz to 19.9 kHz); `filter.q` = Q / 10 − 3.01 dB (FluidSynth's: 0 is Butterworth), and Q / 20 dB more `attenuation`, the DC gain reduction of SF2 8.1.3 and FluidSynth's 1 / √Q; `filter.envelope` = depth in cents with delay, attack, hold, decay (SF2 time × the share it falls) and sustain 1 − sustainModEnv / 1000, played by the voice as ramps in hertz (release not modelled); none when nothing can close the filter |
| `initialAttenuation`                                                                      | `attenuation` = 0.4 × cB / 10 dB (the EMU factor FluidSynth applies, which GeneralUser GS is voiced for), clamped to 0..144 dB                                                                                                                                                                                                                                                                                                                                                                  |
| `pmod`, `imod` records                                                                    | `modulators`: velocity and key sources (linear, concave, convex, switch; both polarities and directions) on attenuation, cutoff, envelope depth and Q, merged with FluidSynth's default (velocity to attenuation; its velocity to cutoff default is inert in FluidSynth and not applied): an instrument modulator replaces a default of the same identity, a preset one adds to it (SF2 9.5)                                                                                                    |
| `exclusiveClass`                                                                          | `exclusiveClass`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `keynumToVolEnvHold`, `keynumToVolEnvDecay`                                               | `envelope.holdPerKey` and `decayPerKey`, in timecents per key; `hold` and `decay` are the values at key 60 and the voice multiplies them by 2 ^ (factor × (60 − key) / 1200) for the struck key, clamped to the region's range, and the timecent sum is capped as FluidSynth does (hold 5000 tc, decay 8000 tc, both at least -12000): exact. The filter's modulation envelope carries `keynumToModEnvHold` and `keynumToModEnvDecay` the same way                                              |
| `pan`                                                                                     | `pan` = value / 500, mono regions only                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| linked left and right samples                                                             | one region with a two-channel ref, left first (below)                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Stereo merge.** A zone whose sample is a left or right half, with a zone in the same instrument
playing its linked partner over exactly the same key and velocity ranges, becomes one region whose
ref names both samples, left first; `fetch` returns two channels and the voice plays them
unpanned. The pair's pitch follows the right zone and the right sample header, as spec 7.10
requires ("their pitch controlled by the right sample's generators"); everything else follows
the left zone, and a right zone that differs in an envelope, attenuation or sample-mode generator
is counted in `report.stereoMismatches`. A half without such a partner, or whose partner's span
would fall outside the sample data, stays a mono region with its own pan and is counted in
`report.unpairedStereo`: for a pair whose zones cover different keys that is two hard-panned mono
regions, which the sampler layers where both cover the key.

**What the `Region` cannot carry is reported, never approximated.** `preset().report` counts,
per preset, the zones with a non-neutral value for each generator the `Region` has no field for
(modulation and vibrato LFOs, the modulation envelope's transient on pitch, effects sends,
`keynum`, `velocity`), zones with a modulator that is not applied (controller, pressure and linked
sources, other destinations), zones expanded per key (`scaleTuning` only),
overlapping region pairs (`layered`, which the sampler sounds together; a key-expanded zone counts
once per key), stereo mismatches and unpaired halves, and dropped zones and loops.

### GeneralUser GS

`pnpm sounds:fetch` (`scripts/sounds/fetch-gm.ts`) downloads GeneralUser GS 2.0.3 and its
license from the author's GitHub repository, pinned by commit in `scripts/sounds/gm.json`,
verifies both by SHA-256, and writes them to `apps/web/public/sounds/gm/`, where only the README
is committed (it has the provenance and the license summary). A network failure or a 5xx is
retried before the script fails naming the URL and the cause. CI caches the files on the pins and
fetches them on a miss, so the GeneralUser GS suite (`src/sf2/general-user-gs.test.ts`) runs
there; locally it skips with a message until the files are fetched.

Measured over the GM set (bank 0 programs 0 to 127 and the standard kit, 129 presets):

- Every program and every GM percussion key, 35 to 81, resolves. 7,998 regions over 971 sample
  refs, 579 of which are played by more than one preset. Resolving the whole set costs about
  50 ms (80 to 95 ms with 18,636 regions before #198 stopped expanding key-scaled hold and decay
  per key; 60 ms before #169, whose regions each carry a modulator list and, where a filter
  can close, a `filter` object), its region maps 1 to 4 ms, and a note-on resolves in tens to
  a few hundred ns, noisy at this scale (measured before #198, on the largest map then, Timpani's 896 regions). The heap figures (7 MiB to
  resolve, 3 MiB for the maps, 1 MiB for the `instrumentsOf` index) are from before #169 and not
  re-measured: the headless shell exposes no heap counter. Decoded sample memory, which the budget
  counts, is unchanged.
- Decoded as Float32 the GM set is 71.5 MiB fetched once per ref, against 121.6 MiB summed per
  preset (`preset().bytes` counts a shared span in every preset that plays it); the whole sample
  chunk is 61.2 MiB. A median preset is 0.41 MiB; the largest are Tremolo, Fast and Slow Strings
  at 8.93 MiB each (the same 21 samples, sliced from different start offsets, so three sets of
  refs) and the standard kit at 5.49 MiB.
- The file is version 2.01: no `sm24`, and no linked stereo samples at all (all 920 are mono), so
  the stereo merge is proved by the synthetic fixture.
- It uses the key-scaled envelope generators heavily: `keynumToVolEnvHold` in 287 zones and
  `keynumToVolEnvDecay` in 676, `scaleTuning` in 156. The envelope factors are carried on the region and scaled in the voice, so those zones stay one region; only the 132 resolved `scaleTuning` zones are still expanded per key, exactly.
- `modEnvToPitch` is set in 457 zones; 447 are transients with a `sustainModEnv` of 1000, and 10
  zones in Ocarina, Bagpipes and Helicopter hold a pitch offset of 94 to 700 cents, which `tune`
  carries. One note of Whistle and of Ocarina rendered through the sampler lands within a cent of
  440 Hz at A4.
- It layers: 70 presets have keys where more than one zone matches, and the sampler sounds them all
  (Fast Strings at C4 is two panned samples, measured at 67% and 43% of the note's energy). 6,458
  zone instances set a low-pass filter (median about 800 Hz), 2,427 of them with a filter envelope
  the voice plays; Synth Bass 1 at C3 rests at 196 and 350 Hz and keeps 2% of its open energy
  above 3 kHz. 14 zones have an audible volume-envelope delay (Synth Strings 2's
  second layer enters 150 ms late, silent until then); 1,864 regions are resonant, and each loses half
  its peak at DC (Music Box, 170 cB, plays 8.5 dB under its unfiltered level); 27 set an exclusive class (the closed hi-hat
  leaves exactly its own level after choking the open one). It also sets modulators the loader does not
  apply (effects-send controllers above all) in 4,215 zones, and LFOs and the modulation envelope's
  pitch transient, which the report counts. Its velocity curves are the modulators' own: 291 instrument zones override the default
  amount of 960 with 700 or 800.
- Three zones (Soundtrack, Birds) start past their loop start and play unlooped.

The fixture the parser tests run on is `test-fixtures/synthetic.sf2`, under 4 KB, written by
`pnpm sounds:fixture` (`scripts/sounds/make-test-sf2.ts`); a scripts test fails when the committed
file and the generator disagree.

## SFZ loader and HQ tier

In `src/sfz/`: a parser and resolver that map an SFZ file onto the shared `Region`, and `SfzPack`,
a `SampleProvider` over one pack directory. The voice code is the SF2 tier's. WP-091 routes the GM
bank and the packs through one `ManagedSampleSource` and owns pack installation; this package
needs only a reader.

```ts
const pack = new SfzPack({ id: 'karoryfer-swagbass', files: { read, size? }, decode? });
const inst = await pack.loadInstrument('swagbass.sfz', { id: 'sfz:karoryfer-swagbass:default', layer? });
// { id, regions: RegionMap, layers: [{ id: 'sw:36', key: 36, label? }], keyswitchRange?, report }
pack.instrumentsOf(ref); // every instrument that references the file
pack.byteLength(ref); // an estimate from files.size before the first fetch, exact after, NaN without a size
await pack.fetch(ref); // reads and decodes one file: { sampleRate, channels, byteLength }
loadSfz(path, read, { packId, layer? }); // the parser alone: { regions, layers, keyswitchRange, report }
```

`loadSfz`, `SfzPack`, `sniffSampleHeader` and `decodeAtNativeRate` are root exports.

### What is read, and when

- **Paths and refs.** A pack is untrusted data. `read` gets pack-relative, `/`-separated paths with
  backslashes already converted and `.`/`..` resolved; a path that leaves the root is refused and
  counted. One ref per sample file, `sfz:<packId>/<path>`, however many regions play it, so loops,
  offsets and keyswitch copies all share one decoded buffer. `fetch` reads only a ref some loaded
  instrument issued. The prefix cannot collide with an SF2 ref (`<font>/<n>/<a>-<b>`), which is what
  WP-091's dispatcher relies on.
- **Lazy, per ADR-0005.** `loadInstrument` reads SFZ text only (the root file and its `#include`s).
  A sample file is read and decoded on the first `fetch`: from the manager's preload plan, which
  asks `RegionMap.candidates()` for every round-robin and random take of a key, or on a miss.
  Eviction and the budget (`HQ_BUDGET_BYTES`, 300 MiB) are the manager's.
- **Decoding at the native rate.** `decodeAudioData` resamples to its context's rate, and SFZ loop
  points and offsets are frames of the file, so `decode.ts` first reads the file's own rate from
  its header (WAV `fmt `, FLAC STREAMINFO's 20-bit field, the Vorbis identification header; Opus
  is 48 kHz) and decodes on an `OfflineAudioContext` of that rate, one per rate, kept. Chromium
  decodes WAV (PCM 8 to 32 bit, float), FLAC and Ogg; there is no decoder of our own. MP3, AIFF and
  anything else reject `fetch`, which the manager and sampler turn into a skipped note and
  `onMiss`. The decoder is injectable (`SfzDecoder`) for tests. `decodeAudioData` detaches its
  input, so the pack decodes a copy of the bytes.
- **Caps on untrusted files** (`SAMPLE_LIMITS` in `sfz/decode.ts`), because a FLAC of constant
  subframes is about 12 bytes per 65,535 frames and a 100 KB file can decode to gigabytes:
  `fileBytes` 128 MiB per sample file, checked from `files.size` before the read (when known) and
  from `bytes.length` after it; `decodedBytes` 256 MiB of Float32 per file, checked against the
  size the header declares (WAV `data` chunk, capped by the bytes held; FLAC STREAMINFO total
  samples times channels, where a total of 0 is refused since nothing then bounds it) before
  `decodeAudioData`, and against the decoded buffer after. Ogg declares nothing in its first page,
  so the file cap and the decoded check are its bound, the latter after the allocation. A refused
  file rejects `fetch` like any other failure. The WAV format tag must be PCM, float or
  extensible: ADPCM and MP3-in-WAV are refused, as Chromium does not decode them. The per-rate
  offline contexts are an LRU of four.
- **Memory.** The manager copies a decoded file once into a buffer of its own, so the transient
  `AudioBuffer` is one sample, not the budget. A decoded file is `channels x frames x 4` bytes, which
  is what `byteLength` returns after the first fetch. Before it the estimate is `files.size` times
  2 for WAV (16-bit PCM becomes 32-bit float), 4 for FLAC and 10 for Ogg. Measured on Karoryfer
  Swagbass (WAV, 44.1 kHz mono, `swagbass_clean.sfz`, 254 samples): 40 files decode in about 10 ms and
  the whole pack in about 175 ms, 184.1 MiB resident.

### Opcodes

| Opcode(s)                                                           | Becomes                                                                                                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<control>`, `<global>`, `<master>`, `<group>`, `<region>`          | Inheritance global, master, group, region; a header resets the levels below it. `<control>` holds `default_path`, `note_offset`, `octave_offset`.                    |
| `#define $NAME value`, `#include "path"`                            | Text substitution from the definition on; includes resolve against the root file, through the reader, to depth 16, cycles detected.                                  |
| `default_path`, `sample`                                            | The ref. A value may contain spaces. `*sine`, `*silence`, `*noise` drop the region, counted.                                                                         |
| `lokey`, `hikey`, `key`, `pitch_keycenter`                          | `keyLo`, `keyHi`, `rootKey` (default 60); note names accepted (c4 = 60); `key=-1` disables the region.                                                               |
| `lovel`, `hivel`                                                    | `velLo`, `velHi`; an inverted range drops the region.                                                                                                                |
| `tune`, `transpose`, `pitch_keytrack`                               | `tune` in cents; a keytrack other than 100 over a range expands to one region per key, as SF2's `scaleTuning` does.                                                  |
| `volume`, `pan`, `amp_veltrack`                                     | `attenuation = -volume`, `pan / 100`, `velocityTrack` (below).                                                                                                       |
| `ampeg_delay`, `_attack`, `_hold`, `_decay`, `_sustain`, `_release` | `envelope`, SFZ defaults (sustain 100 %, release 1 ms); the sampler's minimums still apply.                                                                          |
| `loop_mode`, `loop_start`, `loop_end`, `offset`                     | `oneShot`, or a frame-unit `loop`, and `startFrame`. A loop mode without points would need the loop embedded in the file: played unlooped, counted.                  |
| `group`, `off_by`                                                   | One-way choke (closed hi-hat cuts open, not the reverse).                                                                                                            |
| `trigger`, `seq_length`, `seq_position`, `lorand`, `hirand`         | Parsed and kept; the selection rules and the release triggers are under Sampler.                                                                                     |
| `rt_decay`                                                          | `releaseDecay`, dB per second held, on `trigger=release` regions (0 to 200; elsewhere read and unused).                                                              |
| `sw_lokey`, `sw_hikey`, `sw_last`, `sw_default`, `sw_label`         | One layer per `sw_last` key, `sw:<k>`, which a labelled one makes a set (Articulation sets). Unswitched regions are copied into every layer; the copies share a ref. |

Everything else is counted, never thrown. `report.unknown` holds opcodes this loader does not know,
`report.unsupported` the ones it knows and v1 does not play (filters, envelopes other than amp, LFOs,
`amp_velcurve_N`, `*_cc*`, crossfades, `bend_*`, `polyphony`, `*_random`, ...), `ignoredHeaders` the
skipped `<curve>`, `<effect>`, `<midi>`, `<sample>`, `invalid` values that did not parse (the opcode
is skipped, the region kept), `clamped` values pulled into range, `dropped` regions left out by
reason, plus `embeddedLoop`, `unresolvedIncludes`, `escapedPaths`, `limits` and `notes`. A pack
passes `isClean` when `invalid`, `unresolvedIncludes`, `escapedPaths` and `limits` are empty;
`unknown`, `unsupported` and `unreachable` are allowed. Only an unreadable root file throws (`SfzParseError`).

**`amp_veltrack`.** The voice applies `velocityGain(v) ** velocityTrack`, one reading of
sfzformat.com, where sfizz blends linearly in amplitude. They differ most at low velocity with a
partial track (about -18 dB here against about -10 dB for `amp_veltrack=73` at velocity 30). Nobody
has listened to a real pack against both yet; the choice is open and a change is one line in the voice.

**Known gaps.** Loops embedded in a WAV or FLAC
(`smpl` and cue chunks), filters and filter envelopes, LFOs, crossfades, controllers, and
`seq_position` outside `seq_length` (an authoring error some packs ship: the region is kept with
its impossible position so it never plays, as in sfizz, counted in `report.unreachable`, and
`isClean` allows it). Paths
are case-sensitive, so a pack made on Windows with mismatched case breaks on Linux; WP-091 can build
a case-insensitive index from `listDir`.

### Real packs: `pnpm sfz:check <dir>`

Loads every `.sfz` under a directory, checks that each sample file exists (a case-only difference is
named) and that its header sniffs to WAV, FLAC or Ogg at a usable rate (no Web Audio needed), prints
the report per file and exits 1 on an error: a lost-data entry in `isClean`, a missing file, a bad
header, no regions. Downloaded packs live in the gitignored `local-sounds/` (see its README); the
pure logic is `sfz/check-pack.ts`, covered by a Node test, and the script drives Vitest through
`scripts/sounds/vitest.config.ts` because plain Node cannot import the workspace packages.

### HQ memory budget (WP-094)

`hq-memory-budget.test.ts` asserts the HQ row of the roadmap budgets table: four distinct
Swagbass-shaped packs (254 files of 4.3 s each) on four tracks of the long score, each track
reaching all 49 keys of a 24-fret guitar at both velocity layers, resident at 283.6 MiB of the
300 MiB default with no miss and no eviction. A second case halves the budget and plays through.

### Tests

No sample bytes are committed. `sfz/test/encode.ts` writes PCM WAV (16 and 24 bit) and FLAC with
verbatim subframes in memory. Node tests cover the header sniffing and `SfzPack` over a fake decoder
(refs, `instrumentsOf`, the estimate then the exact size, refusals); browser tests decode real WAV
and FLAC at 22,050, 32,000, 48,000 and 96,000 Hz and compare the integers, and run
`ManagedSampleSource` over `SfzPack` over the synthetic fixture under the `Sampler` (lazy first-use
decoding, `candidates()` preload, exact accounting, a one-shot past note-off, keyswitch layers).

## Articulations

The GM-tier articulation layer (WP-033), in `src/articulations/`, between the scheduler and the
sampler. `planNote` turns one note into a `NotePlan`, pure data: its attacks (`strikes`), a pitch
function in semitones, level breakpoints in dB, a filter, and how it ends (a release time, let
ring to a time, or a legato carry into the next note). `createSamplerSink` executes the plan on
sampler voices. Every constant is in `ARTICULATION` (`parameters.ts`), which the table below
quotes.

### Mapping

| Effect                                               | Automation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dynamics` `ppp` to `fff`                            | Velocity 15, 31, 47, 63, 79, 95, 111, 127 (Guitar Pro's ladder, steps of 16). `f`, the model's default, is 95: the old flat 96.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `accent` normal, heavy                               | +1, +2 steps of 16, capped at 127.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ghost`                                              | -2 steps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `hammerPull` (on the destination)                    | -1 step, and the sample starts 20 ms in (`offset`), past the pick transient. After a legato slide it is no attack at all (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `bend`                                               | Points to a sampled detune curve (2 ms resolution, linear between points): `position` 0 to 60 across the note's own beat, `value` / 2 semitones. Prebend, release and hold shapes are the points; `kind` adds nothing. Holds after the beat. On a tie chain it spans the bare links after it and stops at the first link with its own bend or vibrato, as alphaTab's `extendBendArrowsOnTiedNotes` does: see Tied links.                                                                                                                                                                         |
| `Beat.effects.whammy`                                | The same, added to the bend (negative values dive).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `vibrato` slight, wide; `Beat.effects.vibrato`       | A sine on detune from the onset: slight 5.5 Hz ±0.25 semitone, wide 5 Hz ±0.6; the wider of note and beat wins. A tied link's vibrato takes over at its onset and carries through the bare links after it, phase unbroken.                                                                                                                                                                                                                                                                                                                                                                       |
| `slide` `shift`                                      | A linear glide into `nextOnString`'s pitch over the last 25% of the note, at most 200 ms, ending on the next onset; the next note is struck. On a tie chain only the last link glides: from the origin or a middle link the target is the tied note itself, as alphaTab plays it (`nextNoteOnSameLine`).                                                                                                                                                                                                                                                                                         |
| `slide` `legato`                                     | The same glide, then the voice carries on as the next note: no attack, no velocity of its own, released at the next note's end (or carried again). On a tie chain, only from the last link, as for `shift`.                                                                                                                                                                                                                                                                                                                                                                                      |
| `slide` `intoFromBelow`, `intoFromAbove`             | From 3 semitones below or above, over the first 80 ms (at most a third of the note).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `slide` `outDown`, `outUp`                           | To 3 semitones down or up over the last 80 ms (at most a third). On the origin or any tied link, at the chain's end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `trill`                                              | Retriggers every `trill.speed` note value (16th, 32nd, 64th at the tempo) for the note's length, alternating the note and `trill.fret`, a shorter last stroke when the length is not a multiple; the alternations after the first are hammer-ons (-1 step, 20 ms offset).                                                                                                                                                                                                                                                                                                                        |
| `Beat.effects.tremoloPicking`                        | Retriggers every 8th, 16th or 32nd at the full velocity; a remainder is a shorter last stroke.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `palmMute`                                           | Low-pass at 900 Hz (Butterworth), and the level falls to -18 dB over 250 ms: the shortened envelope. On a tied link of an open string, both from the link's onset.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `dead`                                               | A noise burst instead of the instrument: the `fx:dead` region (100 ms of seeded noise, 1 ms attack, 50 ms decay to silence), low-pass at 2.5 kHz, cut at 80 ms. It damps the string like any note. A dead tied link ends the chain 80 ms after its onset, with no burst.                                                                                                                                                                                                                                                                                                                         |
| `Beat.effects.golpe`                                 | `hit`: a synthesized body hit (`golpeInstrument`, built on first use), played on the beat's track through `sampler.noteOn` so its strip, mute and solo apply. Thumb: a sine gliding 90 to 55 Hz over its 160 ms decay plus 30 ms of noise low-passed at 400 Hz. Finger: 160 to 120 Hz (80 ms) plus 15 ms of noise at 3 kHz. Fretted tracks only. Velocity is the loudest note of the beat, `mf` on a rest. The body is set so the hit's peak is no more than 1 dB above the note it lands on. No pack layer: a sampled body hit would be a separate issue.                                       |
| `pickScrape`                                         | The scrape replaces the pitched note: no course doubling, bend, vibrato, trill or let ring, and it wins over `dead` (Guitar Pro marks a pick slide on a muted note). The `fx:scrape` region (1.1 s of seeded white noise, 10 ms attack, 50 ms release) goes through a bandpass (Q 2) whose centre the plan moves every 10 ms, geometrically, from 3 kHz to 800 Hz for a down scrape and from 800 Hz to 3 kHz for an up one, over the note's length with ties included, capped at 1 s. White noise has no spectrum to detune, so the sweep is the filter. A note on a drum track stays as it was. |
| `harmonic` natural                                   | The node's overtone of the open string: frets 12 (+12), 7 and 19 (+19.02), 5 and 24 (+24), 4, 9 and 16 (+27.86), 3.2 (+31.02), 2.7 (+33.69); a fret on no node plays fretted. Pure intervals, not tempered (`soundingPitch`, `@reprise/model`). +6 dB high shelf at 2 kHz.                                                                                                                                                                                                                                                                                                                       |
| `harmonic` artificial, pinch, tapped, semi, feedback | The fretted note raised by the overtone at `value` frets from it (12 when absent; `soundingPitch`, `@reprise/model`), with the same shelf.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `staccato`                                           | Released at half the note's own beat, ties ignored, as alphaTab's `_getNoteDuration` does. A staccato tied link ends the chain at half its beat.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `letRing`                                            | Rings to the next note on its string or `barEnd`, whichever comes first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Beat.effects.fadeIn`, `fadeOut`                     | Level from -48 dB to 0 (or back) across the beat, linear in dB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Beat.effects.volumeSwell`                           | -48 dB to 0 at half the beat and back to -48 dB at its end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Beat.grace`                                         | Played by the sink with their own effects: grace notes `before` end on the beat (squeezed into a quarter note, the scheduler's lead); on-beat ones start on it and delay the main note (squeezed into half the beat).                                                                                                                                                                                                                                                                                                                                                                            |
| `tie`                                                | The scheduler folds the chain into the origin, and the links' effects play on the origin's voice from their own onsets: see Tied links.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Beat.mix` volume, pan                               | From `mix`, scheduled on the strip at the beat (`setTrack(..., { at, ramp })`), a linear glide over `duration` quarter notes when given; `allTracks` applies it to every track. Rests and tied continuations included.                                                                                                                                                                                                                                                                                                                                                                           |
| `Beat.mix` program                                   | From `mix`, the track's instrument switches at the beat (`setInstrument(..., at)`) to the sink's `instrumentOf(track, program)`; notes already sounding keep theirs. Rests and tied continuations included; replayed at a run start.                                                                                                                                                                                                                                                                                                                                                             |

### Tied links

`planNote` takes the chain's links (`PlanInput.links`, from the event's `continuations`) and plays
the chain as one strike: one pitch function, one list of gain points, the onset filter plus timed
filter changes, and one release. Guitar Pro's semantics are alphaTab 1.8.4's `MidiFileGenerator`,
where a tied link gets no note-on and its pitch carries on from the link before it.

| Effect                                                            | Where                   | Guitar Pro                                | Here                                                                                                                                                     |
| ----------------------------------------------------------------- | ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bend`                                                            | origin or a link        | over its beat and the bare links after it | points taken literally from the segment's onset, to the end of the last link before one that bends or vibrates; the last value holds until the next bend |
| `Beat.effects.whammy`                                             | link's beat             | over that beat                            | points across the link's beat; the previous whammy's last value holds until it                                                                           |
| `vibrato` (note or beat)                                          | link                    | over the link; a bare link inherits it    | sine from the link's onset, continuing through every bare link after it, phase unbroken                                                                  |
| `slide` `outDown`, `outUp`                                        | origin or any link      | at the chain's end                        | one ramp over the chain's last `min(80 ms, (end − last link's onset) / 3)`; the latest segment carrying one decides                                      |
| `slide` `shift`, `legato`                                         | last link               | glides into the note after the chain      | glide over `min(25% × (arrive − last link's onset), 200 ms)`; `legato` carries the voice                                                                 |
| `slide` `shift`, `legato`                                         | origin or a middle link | aims at the tied note itself              | nothing                                                                                                                                                  |
| `palmMute`                                                        | link, origin open       | sound ends 83 ms after the link           | from the link's onset: −18 dB over 250 ms, low-pass 900 Hz (level only under a harmonic origin)                                                          |
| `dead`                                                            | link                    | sound ends 31 ms after the link           | release 80 ms after the link's onset, no burst; later links not heard                                                                                    |
| `staccato`                                                        | link                    | half the link's beat                      | release at half the link's beat; later links not heard                                                                                                   |
| `Beat.effects.fadeIn`, `fadeOut`, `volumeSwell`                   | link's beat             | channel volume over that beat             | gain points over the link's beat, stepping at its onset when the level there differs; 18 dB lower after a palm-muted link                                |
| `harmonic`, `dynamics`, `accent`, `ghost`, `hammerPull`, slide in | link                    | no effect (no note-on)                    | ignored: attack properties                                                                                                                               |
| `letRing`                                                         | link                    | ignored                                   | ignored; a dead or staccato link also cancels the origin's let ring                                                                                      |
| `trill`, `Beat.effects.tremoloPicking`                            | link only               | note-ons over that link                   | not played (Known and deliberate)                                                                                                                        |

A bend spans to the end of the last link before the first link with its own bend or vibrato
(alphaTab's `extendBendArrowsOnTiedNotes`); with no such link that is the whole chain, and when
the first link bends it is the origin's beat. A staccato release before that end, of the note
or of its last link, ends the span there instead, as alphaTab's `_generateBend` does. Drum
tracks take only the links' fades. Three departures from alphaTab, deliberate: vibrato carries
through every bare link, not just the next one, since the model cannot write "no vibrato" on a
link; bend and vibrato add up, where alphaTab plays one of bend, whammy, slide and vibrato per
note; and a bend's span breaks on a link's note **or beat** vibrato, matching the "wider of note and beat" rule above.

On drum tracks only velocity (dynamics, accents, ghost), fades, trills and tremolo apply; drum
articulation variants (rim shot, choke) arrive from the readers already mapped to their GM note.
Pitched tracks take everything, but a harmonic changes the pitch only on a fretted track, which
has the open string it needs.

### Measured (`articulations.test.ts`, the engine driving the real sampler, tapped before the bus)

| Property                                       | Measured                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Full bend, held part                           | 2 semitones up, 0.00001 cent off                                   |
| Natural harmonics at 12, 7, 5, 4               | 2, 3, 4, 5 × the open string within 0.0001 cent                    |
| Natural harmonic at 2.7 (low E), artificial +7 | 7 × the open string and 3 × the fretted note, within 0.0001 cent   |
| Palm mute, energy above 2 kHz                  | 0.033 × the unmuted note's                                         |
| Tie                                            | one onset                                                          |
| Hammer-on                                      | -3.2 dB against the picked note before it                          |
| Shift and legato slide                         | 197 cents of 200 at 1 ms before the next onset; on pitch after it  |
| Legato vs shift, level at the onset            | ×0.84 (still decaying) vs ×17.9 (struck again)                     |
| Vibrato slight, wide                           | 5.5 Hz ±25.0 cents, 5 Hz ±60.0 cents                               |
| Trill (32nds), tremolo (16ths)                 | 8 and 8 onsets, each within 0.06 ms of the grid                    |
| Dead note                                      | a 35 ms burst; the note's pitch carries 3% of its level            |
| Staccato quarter at 120 BPM                    | silent 292 ms after the onset (release at 250 ms)                  |
| Beat volume change to 50                       | lands 5 ms after the beat (the strip's smoothing), ×0.25 the level |

Tied links (`tied-links.test.ts`, same rig, A4 quarter tied at 120 BPM):

| Property                          | Measured                                                       |
| --------------------------------- | -------------------------------------------------------------- |
| Hold bend through the link        | 2 semitones up, 0.000004 cent off                              |
| Release on the link               | 2 semitones before it, 1 semitone halfway, 0.25 cent off       |
| Whammy dive on the link's beat    | -1 semitone halfway, 0.49 cent off                             |
| Slide out on the last link        | on pitch across the origin's end; -209 cents in the last 35 ms |
| Shift from the link vs the origin | 195 cents of 200 at the chain's end vs on pitch (0.00004 cent) |
| Vibrato from the link             | flat before it (0.002 cent), ±60.0 cents from its onset        |
| Dead link                         | silent 200 ms after it (peak 0); one onset                     |
| Palm-muted link, energy > 2 kHz   | 0.011 × the open origin's                                      |
| Fade-in on the link               | ×0.006 the origin's level at its onset, ×0.69 at its end       |

### Articulation sets and what the HQ tier overrides (WP-093)

`ARTICULATION_SETS` is the vocabulary a pack can declare, `default`, `palmMute`, `dead`,
`harmonic`, `artificialHarmonic`, `legato`, `staccato`, `tap`, `slap` and `pop`, exported with the
type `ArticulationSet`. They are the keys of `PackAssignment.entries`: `entries.<set>` is an SFZ
file of the pack that plays the set, and a key outside the list is ignored. A pack can also
declare a set as a labelled keyswitch layer of its default file, and `articulationSetOf(label)`
maps an `sw_label` to a set (`Palm Mute` to `palmMute`, `Hammer-on` to `legato`, `Sustain` to
`default`), or to `undefined`.

**The engine's table.** `resolvePacks` builds one `Voicing` per track, `sets`, `{ instrument?,
layer? }` per set, plus `legatoTrigger`, and the sink reads it through `voicingFor(track)`. A set's
file is parsed like the default one, once per install and path, and is an instrument of its own
(`sfz:<pack>@<n>:<path>`), so eviction, the budget and `packInstrumentsOf` treat it like any other
resident; it plays through the track's strip. A labelled layer of the default file (`setsOfLayers`)
is the same set as a `layer` of the default instrument. An explicit file beats a label, the first
labelled layer of a set wins, and a file that fails to read or parse drops only its set (it never
reaches `LoadResult.fallbacks` for that). A set file that parses but whose samples then fail to
decode for the opening bars is the other failure mode: `dropBrokenPacks` probes the set instruments
too, so that track goes to GM and into `fallbacks`, as for a broken default. `legatoTrigger` is the cheap
gate (a pack has `trigger=legato` regions somewhere); the sink then asks the map about the layer
that plays (`RegionMap.hasLegatoRegionsIn(layer)`), so a hammer-on in a layer with no legato region
plays that layer's attack and not nothing.

**The note-to-set mapping** is one pure function, `voicingOf(input, available)`, which the sink
(playback) and `planInstruments` (memory) both call, so what is played is what was loaded. A
strike has one set, because keyswitches are exclusive, chosen by this priority: `dead`, `harmonic`
or `artificialHarmonic`, `palmMute`, `staccato`, `legato` or `tap`, `slap`, `pop`, else `default`.
Each effect has a fallback chain (an artificial harmonic to `harmonic`, a `tap` to `legato`), and
the first effect whose chain reaches a set the pack has wins; an effect that loses keeps its
synthesized automation on top, so a palm-muted pinch harmonic plays the harmonic layer and is
still filtered at 900 Hz. A track on General MIDI, a drum track, a pack without the set, and a dead note
when the pack has no `dead` set (it is the noise burst, which no other set replaces) all get
`default` and drop nothing.

| The note has                  | The pack has the set                                              | The pack lacks it                             |
| ----------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| palm mute                     | the layer; no 900 Hz low-pass, no -18 dB / 250 ms decay           | default with both (ADR-0004)                  |
| dead note                     | the layer at the note's key, released at 250 ms or the note's end | the noise burst and its 2.5 kHz filter        |
| natural harmonic              | the layer at the sounding pitch; no +6 dB shelf                   | default at the sounding pitch with the shelf  |
| other harmonics               | `artificialHarmonic`, else `harmonic`; no shelf                   | default with the shelf (`semi` keeps its +12) |
| hammer-on or pull-off         | the layer, or `trigger=legato` regions; no 20 ms offset           | the 20 ms offset                              |
| staccato                      | the layer or file; the half-beat release stays                    | default with the half-beat release            |
| tap, slap, pop (beat effects) | `tap` (else `legato`), `slap`, `pop`                              | default (their GM sound is a separate issue)  |

Bends, slides, vibrato, trills, tremolo, dynamics and fades stay automation in both tiers. This
widens ADR-0004's "palm mute and harmonics" to the dead, legato and staccato layers the work
package names, with no new decision. The limits are the ones a voice has: a palm-muted tied link
on an open origin keeps the synthesized link filter, a legato slide's carried voice keeps its
sample, and a trill's alternations and a tremolo's strokes take the note's own set (a trill's
alternation is not given the `legato` layer). A voice a legato slide carries into a note whose set differs keeps the sample it was struck with,
so the effects the new set would have sampled stay synthesized (the palm mute's gain decay still applies; a carried voice never takes a new filter).
The 20 ms offset is dropped by a `legato` set and also whenever a `trigger=legato` region plays.
A tied note is never struck, so the planner leaves it in the default layer. The velocity step of a hammer-on (one lower) stays,
being dynamics and not timbre.

`syntheticGuitarPack()` in `@reprise/audio/testing` is the reference guitar these are tested on:
a sustain layer and palm-mute, harmonic and legato layers, each a sine of its own pitch, and
release samples with `rt_decay`. Its options only add: `selection: true` adds, on keys below the
layers' own, two velocity layers, a `seq_length` and a `lorand`/`hirand` round robin and a
`trigger=first`/`trigger=legato` pair (`GUITAR_SELECTION`); `articulations: true` adds `Dead Note`
and `Staccato` layers (`GUITAR_EXTRA_TONES`); `perFile: true` adds `gtr_pm.sfz` and `gtr_stacc.sfz`
as `entries` (`GUITAR_FILE_TONES`). The default pack keeps its shape.

### Known and deliberate

- **A legato slide into a hammer-on plays two release samples.** In `7/9h11` the slide's carried
  voice keeps the release decision made at the first note, where the next note was a slide target,
  so its release at the hammer-on's onset fires a sample, and the hammered note fires its own at
  the chain's end. Dropping the trigger on an existing `VoiceHandle` would need a contract change;
  `release-trigger-sink.test.ts` pins today's result.
- **Not played on a tied link** (see Tied links above):
  - Trill or tremolo picking written only on a later link: the origin's span the chain, and a
    re-strike mid-chain would need a second strike carrying the remaining links.
  - A link's harmonic, dynamics, accent, ghost, hammer-on or slide in: attack properties, and a
    link is not struck.
  - Let ring on a link: `NoteEvent` carries no bar end for a link.
  - A palm-muted link under a harmonic origin, or under one a legato slide carried in from a
    harmonic, damps the level only: a `BiquadFilter`'s type switches at once, not at a time. A
    carried voice still on its low-pass takes the link's 900 Hz.
  - Vibrato cannot stop inside a chain once started: the model has no "unset".
  - A grace on a tied link's own string, or any grace on a beat whose notes are all tied: that
    beat sends no event, and playing it would need the timeline to break the hold there.
  - A tempo change inside a chain: link onsets are exact, link lengths use the chain's average
    seconds per tick.
  - A grace tied into its main note (Guitar Pro 6+ bend grace) cannot be written: grace notes
    carry no tie (#65).
- **A legato slide's destination keeps its origin's tone.** A `BiquadFilter`'s type switches at
  once, not at a time, so a carried voice cannot change from a palm-muted low-pass to a
  harmonic's shelf without affecting the note still sounding.
- **A mixer change outlives a stop.** The run start replays the changes before it, but nothing
  first restores `track.channel` or the instrument the track was added with (see the
  `InstrumentSink` contract above): seeking back before a program change, or a loop whose range
  contains one, keeps the new program until a run start replays an earlier change. The baseline
  reset WP-050 owns covers the instrument too; on the sampler side the baseline is `addTrack`'s.
- **Vibrato is in Hz, not tempo-synced**, and starts at the onset; Guitar Pro's sounds the same at
  any tempo too.

## Memory manager

ADR-0005's decoded-buffer cache, in `src/samples/`. `ManagedSampleSource` is the `SampleSource`
every instrument plays from: the loaders supply raw PCM through a `SampleProvider`, the manager
decodes it, accounts for it and evicts it, and the sampler never sees the difference.

### The provider seam

```ts
type InstrumentId = string; // 'gm:0:25' = bank:program, 'gm:drums:0' for kits

interface RawSample {
  sampleRate: number;
  channels: Float32Array[];
  byteLength: number;
}

interface SampleProvider {
  instrumentsOf(ref: SampleRef): InstrumentId[]; // every preset that references the sample
  fetch(ref: SampleRef): Promise<RawSample>; // raw PCM; the manager builds the AudioBuffer
  byteLength(ref: SampleRef): number; // decoded size estimate, reserved before the fetch
}
```

A `SampleRef` names a sample slice, not a preset's copy of it: GeneralUser GS shares samples
across presets (its three string sections share 8.9 MiB), so one buffer can belong to several
instruments.

The seam carries no loop points: a `Region` holds its loop in seconds and the sampler reads it
there. Two provider answers are refused rather than trusted: a sample `instrumentsOf` names no
instrument for rejects on load, since a buffer nobody owns could never be evicted; a `byteLength`
that is not a finite byte count reserves nothing.

### API

```ts
const source = new ManagedSampleSource(provider, context, { budgetBytes: GM_BUDGET_BYTES });
const plan = await source.load(score, regionMapOf, { bars: 4 }); // AudioEngine.load's half
source.memory(); // the engine's MemoryReport: { decodedBytes, budgetBytes, residents, unused, shortfall }
const off = source.on('memory', (stats) => {}); // coalesced to one per animation frame
source.budgetBytes = 300 * MEGABYTE; // settable at runtime; lowering it evicts at once
source.counters; // { fetches, evictions, pinnedEvictions }

planInstruments(score, { bars?, instrumentOf? }); // instruments and keys per track
planSamples(plan, regionMapOf); // the SampleRefs those keys reach
```

### Accounting, eviction and pinning

- **Accounting** is per buffer, `numberOfChannels × length × 4` bytes, from the buffer built and
  not from the provider's estimate, and counted once however many instruments share it. The estimate only reserves room while a fetch is in flight,
  so a burst of loads (a preload) evicts ahead and cannot overshoot.
- **Eviction is by whole instrument**, least recently used first, whenever resident plus
  reserved bytes exceed the budget. A buffer is attributed to every instrument that references
  it and freed only when the last resident one goes, so evicting one of two presets that share a
  sample keeps the sample. Recency is `peekBuffer`, which the sampler calls for every
  note it starts, and `getBuffer`. Half an instrument would save little and turn into skipped
  notes all over its range.
- **Pinning.** `switchSong` (and so `load`) pins the instruments the new song uses and evicts
  every other one at once. A leftover loaded afterwards (an editor preview on a new track, a
  program change the plan did not see) is evicted before any pinned instrument, however recent;
  a sample it shares with a pinned instrument stays.
- **The instruments of the sample being loaded are never its victims**, so the budget is exceeded
  only when they alone are larger than the whole budget.
- **A resident is an instrument the song plans that holds decoded samples, or a leftover.** A
  decoded buffer makes resident only the owners the current plan pins (all of them when none is
  pinned, so the buffer always has an owner to free it), and a preset that merely shares the song's
  samples (a bank variation, an alias) is not counted. A switch to a song on such a preset makes it
  resident with the shared buffers before the old owner is evicted, so nothing is fetched again.
- **An eviction is counted only when it frees a buffer**: dropping an alias whose samples another
  resident still holds leaves `counters.evictions` and `pinnedEvictions` alone.

### Planning and preload

`planInstruments` walks the playback sequence, not written order, so a `Beat.mix` program change
reached through a repeat or a jump is attributed to the bars it actually sounds in. Each track
plans its own program even when it has no notes (it costs nothing until a note asks for it).
Keys are the ones the sink strikes: the note's sounding pitch rounded (`soundingPitch` from
`@reprise/model`, so a harmonic plans the overtone it plays, not the fretted key), plus grace notes
and the trill's alternate fret.
`planSamples` takes every layered region of a key and every release region of it (`candidates`).

The plan is per note, not per instrument: `planInstruments` asks `voicingOf` for each note, with
`PlanOptions.voicingFor(track)` (the track's `PlanVoicing`, where each set lives as a layer id or
an instrument id), and puts its keys where the note will sound. `InstrumentUse.keys` is the
default layer, `InstrumentUse.layers` is `{ layer, keys }[]` for each keyswitch layer a note's
set names, and a per-file set is an `InstrumentUse` of its own (so `switchSong` pins it). `planSamples`
walks only those layers, not `[undefined, ...map.layers]`, which is ADR-0005's "articulation
layers derived from the score; nothing else is loaded": a song with no palm mute decodes no
palm-mute sample and plans no palm-mute file, while the release regions of its planned keys stay
planned, since they must be resident at the note-off.

`load` decodes every sample the opening `bars` (default 4) can reach before it resolves, at every
velocity and in each articulation layer the score plays, since dynamics are the scheduler's to
decide. It then warms the rest of the song in the background, four fetches at a time, but only
if all of it fits the budget: otherwise warming would evict what the opening bars need. A song
switch (or a later `load`) stops the warm-up after what is already in flight, so the previous song
is never fetched into the new one's budget; `settled()` resolves once the queue has drained.

### The degrade path

Below the needs of the current song nothing throws. Pinned instruments are evicted least
recently used first (`counters.pinnedEvictions` counts them); the sampler finds a non-resident
sample, skips the note, reports it through `onMiss` and requests the load, so the next note on
it plays. `memory()` shows the overrun, so the settings can say why.

### Budgets, measured

`memory-budget.test.ts` runs the reference long score (8 tracks, 300 bars, with structure)
against a synthetic GM set shaped like GeneralUser GS as WP-032 measured it: 128 programs and
the standard kit, the first six programs of each family sharing samples in pairs, sized so the
presets add up to 121.6 MiB and the distinct samples to 71.5 MiB, a zone every 3 semitones. The
GM budget is 80 MiB.

| Case                                 | Result                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| `planInstruments`, 8 × 300           | about 17 ms                                                    |
| Song A, 8 guitar and bass programs   | 1.9 MiB resident, 0 misses in 62,124 notes                     |
| Song B after A, 7 programs and a kit | 2.1 MiB resident, 0 misses                                     |
| Every zone of song A's 6 sample sets | 6.9 MiB                                                        |
| The whole GM set, every sample       | 71.5 MiB resident (121.6 MiB counted per preset), fits         |
| Song A under half its needs          | peak at the budget, notes skipped and reloaded, nothing thrown |

## Tests and the offline harness

`pnpm --filter @reprise/audio test` runs the package's two Vitest projects from the root config,
with no sound device:

- **`audio`**, in Vitest browser mode on headless Chromium (Playwright), for the reasons under
  Decisions. CI installs the headless shell without `--with-deps`, as the root `AGENTS.md`
  describes.
- **`audio-node`**, files named `*.node.test.ts`, in plain Node: proves that what claims to be
  DOM-free is. `sf2/sf2.node.test.ts` parses the synthetic bank (its bytes provided by
  `scripts/sounds/provide-sf2.ts`, since the package is typed without Node's modules), resolves
  presets and reads a sample; `test/signal.node.test.ts` covers the signal measurements.

`src/test/` is the shared harness, for test files only:

| Helper                                    | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderScore(score, options)`             | A fresh transport over the real sampler and articulations, play at time 0, rendered offline. `instruments` is GeneralUser GS (the GM tier, through the memory manager, every sample decoded first, program changes honoured) or a function per track. `tap: 'strips'` records before the master bus, without its 6 ms pre-delay; `actions` call the engine at a context time. Returns the signal, the sampler, the memory manager and every `missed` note. |
| `loadGeneralUser()`                       | The fetched bank, parsed once; `undefined` until `pnpm sounds:fetch`, and the GM suites skip with a message.                                                                                                                                                                                                                                                                                                                                               |
| `detectOnsets(signal, { rise? })`         | Sounds after silence, above a floor 50 dB under the signal's peak unless `floor` is given; with `rise`, also re-attacks over a ringing note, read off the first difference (a pick is a burst of highs, which a filtered GM region may not keep).                                                                                                                                                                                                          |
| `pitchAt(signal, time)`                   | The fundamental by YIN, within a cent on a tone whose harmonics fool a zero-crossing count; `undefined` on noise or silence.                                                                                                                                                                                                                                                                                                                               |
| `bandEnergy(signal, low, high, from, to)` | RMS of a frequency band from a Hann-windowed FFT (a sine of amplitude `a` reads `a / √2`).                                                                                                                                                                                                                                                                                                                                                                 |
| `rms`, `peak`, `toneLevel`, `cents`       | As before; `sampler/test/offline.ts` keeps its sample-array signatures over these.                                                                                                                                                                                                                                                                                                                                                                         |

**The corpus smoke** (`src/test/fixtures.test.ts`) plays every fixture of `fixtures/` through
the GM tier at 22.05 kHz and asserts no missed note, finite samples, a peak at most 1, sound
when the fixture has notes, and decoded memory within the 80 MiB GM budget. Audio may not import
`@reprise/formats`, so the project's global setup (`scripts/fixtures/provide-scores.ts`) reads the
fixtures in Node through `read`, the dispatcher the app uses, and hands them to the browser as
native documents through Vitest's `provide`. A fixture that fails to read fails the setup rather
than shrinking the smoke. Measured: the heaviest fixtures are the drum ones,
`percussion-all.gp5` at 5.5 MiB over 35 instruments and `drum-tabs.gp` at 4.8 MiB over 30; the
27 fixtures render in about two seconds together. The timing a test measures is deterministic;
the samples themselves match across runs only to within float jitter (about 2e-6 relative), so
a test compares measurements, never a hash of the output.

The smoke found the harmonic gap in `planInstruments` independently of #79, which fixed it (see
Planning and preload).

## Standalone click (#205)

`engine.startClick(settings?)` runs a metronome with no score, for WP-072 and anything else that
wants a click with no song open. `createStandaloneClick({ context, sink, scheduler?, lookahead?, startLatency? })`
is the engine-free core; the engine gives it a `ClickSynth` on the master bus.

- `ClickSettings`: `bpm` (10 to 600, of the beat the caller picks from the time signature: x/4 counts quarters, 6/8 is `beatsPerBar: 2, subdivision: 3` at the dotted quarter; the engine has no note value and WP-072's time-signature control owns the mapping), `beatsPerBar` (1 to 32),
  `accents` (a boolean per beat of the bar; `[true]` stresses the downbeat, `[]` none),
  `subdivision` (1 quarters, 2 eighths, 3 triplets, 4 sixteenths) and `volume` (0 to 1).
  `DEFAULT_CLICK_SETTINGS` is 100 bpm in 4 with the downbeat stressed.
- Same lookahead clock as the transport (a 200 ms window, a 25 ms worker tick, 30 ms start
  latency), so clicks are on the audio clock, not on a timer. The first click is beat 1 of the bar (accented if `accents[0]`).
- `bpm` changes re-time the next click from the last one sent, at the new gap (no waiting out
  a slow old beat); `beatsPerBar`, `accents` and `subdivision` from the next beat (a new
  `beatsPerBar` takes the bar in progress: it ends at once when the position is past the new length,
  else runs on to it), and `volume` at once: no beat is cut short and none doubled.
- Subdivision clicks are softer and lower than a beat (`click(when, false, true)`).
- Exclusive with the song: `play` stops the click, `startClick` pauses the song. The `click`
  event (a boolean) reports both, so a mirror needs no guess.
- `stopClick` silences from `currentTime`, including the clicks already in the window.

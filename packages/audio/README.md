# @reprise/audio

The playback engine: the transport and lookahead scheduler (WP-030), the sampler (WP-031), the
SF2 loader (WP-032), articulations (WP-033) and the memory manager (WP-034). This README covers
what exists so far: the transport and the contract the sampler plugs into first, then the
sampler itself.

## Architecture

```
main thread                                     audio thread (native Web Audio)
-----------                                     -------------------------------
25 ms worker timer -> advance(run, now, now + 0.2) --> InstrumentSink.noteOn -> sampler voices -> strips --+
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
  mix?(event: MixEvent): void; // a beat's mixer change, rests and tied continuations included
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
  when: number; // AudioContext time of the beat; currentTime when handed out late
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
  (a hold bend, a slide out, vibrato) starts there. Playing those effects is the articulation
  layer's job and is tracked in #72; until then the origin's effects alone are played.
- **Mixer changes** arrive as `MixEvent`s through `mix`, one per beat carrying `Beat.mix`,
  whether the beat is played, a rest or a tied continuation; a `NoteEvent` with no note was the
  alternative, but it would make `note` optional for every consumer and send a mixer change once
  per note. `mix` is the one place mixer changes arrive, so a sink does not read `beat.mix` in
  `noteOn`. A change handed out late is moved to `currentTime`, never dropped, because it holds
  for the rest of the song. Changes before the point playback starts from are not replayed.
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
  idea for the metronome and the count-in; `ClickSynth` is the built-in one. **Route it through
  the sampler's master bus**, `new ClickSynth(context, sampler.master.input)`: the bus's limiter
  delays everything through it by about 6 ms (see the sampler's "limiter" note), so a click sent
  straight to the destination lands 6 ms ahead of the notes. The engine's default `ClickSynth`
  goes to the destination only because the engine has no sampler of its own.

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
  Through the real sampler (`engine-sampler.test.ts`) every onset lands at `when` plus the
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

## Sampler

The sampler engine of [ADR-0004](../../docs/decisions/0004-own-sampler-engine-two-loaders.md),
in `src/sampler/`: region lookup, voice allocation and stealing, per-voice automation,
envelopes, loop points, channel strips and the master bus. It owns no sample data; buffers come
through a `SampleSource`, which is where the loaders (WP-032) and the memory manager (WP-034)
plug in.

### Graph

```text
 per voice
 AudioBufferSource -> Gain (ADSR) -> BiquadFilter -> Gain (level) -> [StereoPanner] -> strip input
   playbackRate: key - rootKey + tune      lowpass, open at Nyquist   velocity, region   only when the
   detune: automation, semitones           until an articulation      attenuation, dB    region pans
                                           closes it                  automation

 per track (ChannelStrip)
 input -> insert.input -> insert.output -> Gain (volume) -> StereoPanner -> Gain (mute/solo gate) -> master
          (effects, WP-092; straight through now)

 master bus (MasterBus)
 input -> DynamicsCompressor (limiter: -1 dBFS, ratio 20, knee 0) -> Gain (master) -> destination
```

### Contracts for the loaders and the memory manager

```ts
type SampleRef = string; // opaque; only the SampleSource that issued it resolves it

interface Envelope {
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
  loop?: { start: number; end: number }; // seconds into the decoded buffer
  envelope: Envelope;
  layer?: string; // articulation layer; absent = default
  attenuation?: number; // dB, positive is quieter: SF2's sign; an SFZ loader negates its `volume`
  pan?: number; // -1..1, for a mono sample; absent or 0 adds no panner to the voice
}

class RegionMap {
  constructor(regions: readonly Region[]);
  resolve(key: number, velocity: number, layer?: string): Region | undefined;
  readonly layers: string[];
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

`resolve` takes the first exact match in map order; failing that, the region nearest by key and
then by velocity, so a pack that stops short of a drop tuning still sounds. A layer the map lacks
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
`AudioBufferSourceNode.loop` cannot be switched off sample-accurately; `delayVolEnv` becomes a
later `when`; the stereo zones of a sample pair (ruling on this PR) are merged into one two-channel
buffer, which the voice graph passes through unchanged; a mono zone's `pan` goes to `Region.pan`;
`keynumToVolEnvHold` and `keynumToVolEnvDecay` have no home yet and are a contract issue if a pack
needs them.

### Sampler API

```ts
const sampler = new Sampler(context, { polyphony: 64 });
sampler.addTrack(track, instrument); // a strip per track, from track.channel
sampler.setTrack(trackId, { volume, pan, mute, solo }); // AudioEngine.setTrack, 0..127 units
const voice = sampler.noteOn(trackId, { key, velocity, when, string, layer, offset, letRing });
voice?.rampDetune(2, when + 0.2); // semitones, absolute times
voice?.setGain(-6, when + 0.1); // dB relative to the velocity level
voice?.setFilter({ frequency: 1200, q: 1 }, when);
sampler.noteOff(voice, when + 0.5); // ignored for let-ring voices
sampler.previewNote(trackId, note); // now, at velocity 96, through the track's strip
await sampler.preload(trackId, [{ key, velocity }]);
```

`createSamplerSink(sampler)` is the scheduler's `InstrumentSink` over the sampler: `noteOn(event)`
starts the note at `event.when` at velocity 96 (flat until WP-033 maps dynamics) and releases it
at `when + duration`; a let-ring note instead rings to the next note on its string or to
`event.barEnd`, whichever comes first; `allNotesOff(when)` releases every voice, the ones
scheduled after `when` included (a release before a voice's start time is a 0-to-0 fade, so it
never sounds). It keeps no handles: the sampler's voice set is the state.

### Decisions

- **Two gains per voice.** The envelope and the articulation automation (dB) live on separate
  `GainNode`s, so a gain ramp from an articulation never cancels the ADSR, and the release can
  `cancelAndHoldAtTime` the envelope alone. The plan's order (source, gain, filter) holds; the
  level gain after the filter is the extra node.
- **Pitch** is split: `playbackRate` carries the key shift and region tune, fixed per voice;
  `detune` starts at 0 and carries only automation, so bend and vibrato curves are relative to
  the written note. Measured on a rendered 440 Hz sine by interpolated zero crossings, every
  case in the test lands within 0.001 cent of the target.
- **Envelope shapes.** Linear attack, exponential decay and release (aimed at -80 dB, then set
  to 0 and the source stopped), so the release reaches exact silence. Chromium's
  `cancelAndHoldAtTime` holds nothing when no ramp spans the release time, so the release also
  sets the analytic envelope value at that time to anchor the fade.
- **Stealing** is released voices first, then the quietest at the new note's time (velocity and
  envelope, computed analytically), then the oldest; a note that has not started yet is never
  stolen. The stolen voice fades over 5 ms from its level at that moment, release in progress
  included, and no longer counts against the limit.
- **Strings choke.** A new note on a string releases whatever sounds on that string, let-ring or
  not; string 0 (drum and pitched tracks) never chokes. A let-ring voice ignores note-off and
  rings to the next note on its string or to `letRing.until`, the end of the bar the scheduler
  supplies.
- **A non-resident sample is a skipped note, not a late one.** A scheduled note cannot wait for a
  decode; `noteOn` returns `undefined`, requests the load and reports through `onMiss`. Playback
  start pre-warms with `preload` (ADR-0005).
- **Channel units.** `setTrack` takes the model's 0..127 volume and pan; volume follows the MIDI
  curve `(v / 127)^2`, pan 64 is centre. `ChannelStrip.set` takes linear gain and -1..1 pan.
- **The limiter is Chromium's compressor**, which is not transparent: it applies automatic makeup
  gain (about +0.5 dB at these settings), its detector takes the first 100 ms or so of a render to
  settle, and it has a fixed pre-delay, measured at 264 frames (5.99 ms at 44.1 kHz): everything
  through the master bus lands that much after its `when`. Tests that compare levels play below
  the threshold and measure after that; a test that measures onsets must tap before the bus.

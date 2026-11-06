# @reprise/audio

The playback engine: the transport and lookahead scheduler (WP-030), the sampler (WP-031), the
SF2 loader (WP-032), articulations (WP-033) and the memory manager (WP-034). This README covers
what exists so far: the transport and the contract the sampler plugs into first, then the
sampler itself, the SF2 loader, the articulation layer between the scheduler and the sampler, and
the memory manager.

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
  (a hold bend, a slide out, vibrato) starts there. Playing those effects is the articulation
  layer's job and is tracked in #72; until then the origin's effects alone are played.
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
 AudioBufferSource -> Gain (ADSR) -> [BiquadFilter] -> BiquadFilter -> Gain (level) -> [StereoPanner] -> strip input
   playbackRate: key - rootKey + tune  Region.filter:   lowpass, open at    velocity, region   only when the
   detune: automation, semitones       only when the    Nyquist until an    attenuation, dB    region pans
                                       region filters   articulation        automation
                                                        closes it

 per track (ChannelStrip)
 input -> Gain (mute/solo gate) -> insert.input -> insert.output -> Gain (volume) -> StereoPanner -> master
 previewInput ---------------------^        (effects, WP-092; straight through now)

 master bus (MasterBus)
 input -> DynamicsCompressor (limiter: -1 dBFS, ratio 20, knee 0) -> Gain (master) -> destination
```

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
  loop?: { start: number; end: number }; // seconds into the decoded buffer
  envelope: Envelope;
  layer?: string; // articulation layer; absent = default
  attenuation?: number; // dB, positive is quieter: SF2's sign; an SFZ loader negates its `volume`
  pan?: number; // -1..1, for a mono sample; absent or 0 adds no panner to the voice
  filter?: { cutoffHz: number; q: number }; // static low-pass from the note's start; q in dB, Web Audio's lowpass unit
  exclusiveClass?: number; // a new note of the class chokes the sounding ones on the track's instrument
}

class RegionMap {
  constructor(regions: readonly Region[]);
  resolveAll(key: number, velocity: number, layer?: string): Region[]; // every layer of the note
  resolve(key: number, velocity: number, layer?: string): Region | undefined; // resolveAll's first
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

`resolveAll` returns every exact match in map order, since an SF2 preset layers zones by design (a
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
`Envelope.delay`; the filter and its envelope's held level become `Region.filter`; the stereo zones of a sample pair (ruling on this PR) are merged into one two-channel
buffer, which the voice graph passes through unchanged; a mono zone's `pan` goes to `Region.pan`;
`keynumToVolEnvHold` and `keynumToVolEnvDecay` are expanded to one region per key (see
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
});
voice?.rampDetune(2, when + 0.2); // semitones, absolute times
voice?.setGain(-6, when + 0.1); // dB relative to the velocity level
voice?.setFilter({ frequency: 1200, q: 1 }, when); // the articulation filter, after Region.filter
sampler.noteOff(voice, when + 0.5); // ignored for let-ring voices
sampler.previewNote(trackId, note); // now, at velocity 96, through the strip past its mute gate
await sampler.preload(trackId, [{ key, velocity }]);
```

`noteOn` starts a voice per region `resolveAll` returns and hands back one handle for all of them:
detune, gain, filter and release reach every layer, and `endTime` is the last one's.

`createSamplerSink(sampler, { deadNote?, instrumentOf? })` is the scheduler's `InstrumentSink` over the sampler,
with the articulation layer described under [Articulations](#articulations): each event becomes
attacks, pitch and level automation, a filter and a release; `allNotesOff(when)` releases every
voice, the ones scheduled after `when` included (a release before a voice's start time is a 0-to-0
fade, so it never sounds), forgets any legato slide waiting for its next note, and drops the
program changes scheduled after `when` (the scheduler sends each again when playback reaches its
beat, so a pause or seek inside the lookahead never plays a later program early). A
`MixEvent`'s `mix.program` switches the track's instrument at the beat through `setInstrument`, to what
`instrumentOf(track, program)` returns (the caller's region map and source for that program;
`undefined` keeps the current one), the same playback-order attribution the memory planner uses.

`noteOn`'s `instrument` plays a region of another instrument through the track's strip: the dead
note's noise burst uses it, so it works whichever tier the track is on. `previewNote` joins the
strip after its mute gate, so a note clicked in the editor sounds on a muted track and beside a
soloed one; it still goes through the insert, the fader and the panner.

### Decisions

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
- **Stealing** is released voices first, then the quietest at the new note's time, then the
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

| SF2 generator                                                                   | `Region`                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `keyRange`, `velRange`                                                          | `keyLo`..`keyHi`, `velLo`..`velHi`: the instrument zone's range intersected with the preset zone's; an empty intersection drops the zone                                                                                                                                                                                             |
| `overridingRootKey`, else `shdr.originalPitch`                                  | `rootKey`; an `originalPitch` of 255 (unpitched) reads as 60                                                                                                                                                                                                                                                                         |
| `coarseTune`, `fineTune`, `shdr.pitchCorrection`                                | `tune` = coarse × 100 + fine + correction, in cents                                                                                                                                                                                                                                                                                  |
| `modEnvToPitch`, `sustainModEnv`                                                | `tune` += depth × (1000 − sustain) / 1000: the pitch the modulation envelope holds after its transient is a fixed offset (GeneralUser GS tunes its Ocarina with it)                                                                                                                                                                  |
| `scaleTuning` ≠ 100                                                             | one region per key, `rootKey` = key, `tune` = scale × (key − root) + the cents above: exact                                                                                                                                                                                                                                          |
| `sampleModes` 1 and 3                                                           | `loop`, in seconds from the slice start; 3 (loop until release) as a plain loop. 0 and 2 play once                                                                                                                                                                                                                                   |
| address offsets (`start`, `end`, `startloop`, `endloop`, fine + 32768 × coarse) | the slice the ref names and the loop inside it; a loop starting before the start offset cannot live in the slice and is dropped (reported)                                                                                                                                                                                           |
| `attackVolEnv`, `holdVolEnv`                                                    | `envelope.attack`, `.hold`: 2^(timecents / 1200) seconds                                                                                                                                                                                                                                                                             |
| `sustainVolEnv`                                                                 | `envelope.sustain` = 10^(−cB / 200); 1000 cB (100 dB) and more is 0                                                                                                                                                                                                                                                                  |
| `decayVolEnv`                                                                   | `envelope.decay` = SF2 time × min(sustain dB, 80) / 100: SF2 times a full 100 dB fall at a constant dB rate, the sampler the fall to the sustain level, or -80 dB at most                                                                                                                                                            |
| `releaseVolEnv`                                                                 | `envelope.release` = SF2 time × 80 / 100, the sampler's release ending at -80 dB; exact from full level, slower from a lower one                                                                                                                                                                                                     |
| `delayVolEnv`                                                                   | `envelope.delay`, seconds, when above the spec's 1 ms default                                                                                                                                                                                                                                                                        |
| `initialFilterFc`, `modEnvToFilterFc`, `sustainModEnv`, `initialFilterQ`        | `filter.cutoffHz` from fc + depth × (1000 − sustain) / 1000 cents, the held level as for the pitch, clamped to 1500 to 13500 cents (20 Hz to 19.9 kHz); `filter.q` = Q / 10 − 3.01 dB (FluidSynth's: 0 is Butterworth), and Q / 20 dB more `attenuation`, the DC gain reduction of SF2 8.1.3 and FluidSynth's 1 / √Q; none when open |
| `exclusiveClass`                                                                | `exclusiveClass`                                                                                                                                                                                                                                                                                                                     |
| `keynumToVolEnvHold`, `keynumToVolEnvDecay`                                     | one region per key, with hold and decay at timecents + factor × (60 − key): exact                                                                                                                                                                                                                                                    |
| `initialAttenuation`                                                            | `attenuation` = cB / 10 dB, positive quieter, plus the resonance's DC reduction above                                                                                                                                                                                                                                                |
| `pan`                                                                           | `pan` = value / 500, mono regions only                                                                                                                                                                                                                                                                                               |
| linked left and right samples                                                   | one region with a two-channel ref, left first (below)                                                                                                                                                                                                                                                                                |

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
(modulation and vibrato LFOs, the modulation envelope's transient on pitch and on the filter,
effects sends, `keynum`, `velocity`), zones under non-default modulators, zones expanded per key,
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

- Every program and every GM percussion key, 35 to 81, resolves. 16,100 regions over 971 sample
  refs, 579 of which are played by more than one preset. Resolving the whole set costs about
  60 ms and 7 MiB of heap, its region maps 4 ms and 3 MiB, and the `instrumentsOf` index 7 ms and
  1 MiB; a note-on resolves on the largest map (Timpani, 896 regions) in about 35 ns.
- Decoded as Float32 the GM set is 71.5 MiB fetched once per ref, against 121.6 MiB summed per
  preset (`preset().bytes` counts a shared span in every preset that plays it); the whole sample
  chunk is 61.2 MiB. A median preset is 0.41 MiB; the largest are Tremolo, Fast and Slow Strings
  at 8.93 MiB each (the same 21 samples, sliced from different start offsets, so three sets of
  refs) and the standard kit at 5.49 MiB.
- The file is version 2.01: no `sm24`, and no linked stereo samples at all (all 920 are mono), so
  the stereo merge is proved by the synthetic fixture.
- It uses the key-scaled envelope generators heavily: `keynumToVolEnvHold` in 287 zones and
  `keynumToVolEnvDecay` in 676, `scaleTuning` in 156. All are expanded per key, exactly.
- `modEnvToPitch` is set in 457 zones; 447 are transients with a `sustainModEnv` of 1000, and 10
  zones in Ocarina, Bagpipes and Helicopter hold a pitch offset of 94 to 700 cents, which `tune`
  carries. One note of Whistle and of Ocarina rendered through the sampler lands within a cent of
  440 Hz at A4.
- It layers: 70 presets have keys where more than one zone matches, and the sampler sounds them all
  (Fast Strings at C4 is two panned samples, measured at 67% and 43% of the note's energy). 6,458
  zone instances set a low-pass filter (median about 800 Hz), 2,427 of them with a filter envelope
  whose held level the cutoff carries; Synth Bass 1 at C3 filters at 227 and 368 Hz and keeps 0.3%
  of its open energy above 3 kHz. 14 zones have an audible volume-envelope delay (Synth Strings 2's
  second layer enters 150 ms late, silent until then); 1,864 regions are resonant, and each loses half
  its peak at DC (Music Box, 170 cB, plays 8.5 dB under its unfiltered level); 27 set an exclusive class (the closed hi-hat
  leaves exactly its own level after choking the open one). It also uses non-default modulators in
  4,215 zones, which nothing applies, and LFOs and the modulation envelope's transients, which the
  report counts.
- Three zones (Soundtrack, Birds) start past their loop start and play unlooped.

The fixture the parser tests run on is `test-fixtures/synthetic.sf2`, under 4 KB, written by
`pnpm sounds:fixture` (`scripts/sounds/make-test-sf2.ts`); a scripts test fails when the committed
file and the generator disagree.

## Articulations

The GM-tier articulation layer (WP-033), in `src/articulations/`, between the scheduler and the
sampler. `planNote` turns one note into a `NotePlan`, pure data: its attacks (`strikes`), a pitch
function in semitones, level breakpoints in dB, a filter, and how it ends (a release time, let
ring to a time, or a legato carry into the next note). `createSamplerSink` executes the plan on
sampler voices. Every constant is in `ARTICULATION` (`parameters.ts`), which the table below
quotes.

### Mapping

| Effect                                               | Automation                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dynamics` `ppp` to `fff`                            | Velocity 15, 31, 47, 63, 79, 95, 111, 127 (Guitar Pro's ladder, steps of 16). `f`, the model's default, is 95: the old flat 96.                                                                                                                                           |
| `accent` normal, heavy                               | +1, +2 steps of 16, capped at 127.                                                                                                                                                                                                                                        |
| `ghost`                                              | -2 steps.                                                                                                                                                                                                                                                                 |
| `hammerPull` (on the destination)                    | -1 step, and the sample starts 20 ms in (`offset`), past the pick transient. After a legato slide it is no attack at all (below).                                                                                                                                         |
| `bend`                                               | Points to a sampled detune curve (2 ms resolution, linear between points): `position` 0 to 60 across the note's own beat, `value` / 2 semitones. Prebend, release and hold shapes are the points; `kind` adds nothing. Holds after the beat. On a tie chain, see `tie`.   |
| `Beat.effects.whammy`                                | The same, added to the bend (negative values dive).                                                                                                                                                                                                                       |
| `vibrato` slight, wide; `Beat.effects.vibrato`       | A sine on detune from the onset: slight 5.5 Hz ±0.25 semitone, wide 5 Hz ±0.6; the wider of note and beat wins.                                                                                                                                                           |
| `slide` `shift`                                      | A linear glide into `nextOnString`'s pitch over the last 25% of the note, at most 200 ms, ending on the next onset; the next note is struck.                                                                                                                              |
| `slide` `legato`                                     | The same glide, then the voice carries on as the next note: no attack, no velocity of its own, released at the next note's end (or carried again).                                                                                                                        |
| `slide` `intoFromBelow`, `intoFromAbove`             | From 3 semitones below or above, over the first 80 ms (at most a third of the note).                                                                                                                                                                                      |
| `slide` `outDown`, `outUp`                           | To 3 semitones down or up over the last 80 ms (at most a third).                                                                                                                                                                                                          |
| `trill`                                              | Retriggers every `trill.speed` note value (16th, 32nd, 64th at the tempo) for the note's length, alternating the note and `trill.fret`, a shorter last stroke when the length is not a multiple; the alternations after the first are hammer-ons (-1 step, 20 ms offset). |
| `Beat.effects.tremoloPicking`                        | Retriggers every 8th, 16th or 32nd at the full velocity; a remainder is a shorter last stroke.                                                                                                                                                                            |
| `palmMute`                                           | Low-pass at 900 Hz (Butterworth), and the level falls to -18 dB over 250 ms: the shortened envelope.                                                                                                                                                                      |
| `dead`                                               | A noise burst instead of the instrument: the `fx:dead` region (100 ms of seeded noise, 1 ms attack, 50 ms decay to silence), low-pass at 2.5 kHz, cut at 80 ms. It damps the string like any note.                                                                        |
| `harmonic` natural                                   | The node's overtone of the open string: frets 12 (+12), 7 and 19 (+19.02), 5 and 24 (+24), 4, 9 and 16 (+27.86), 3.2 (+31.02), 2.7 (+33.69); a fret on no node plays fretted. Pure intervals, not tempered. +6 dB high shelf at 2 kHz.                                    |
| `harmonic` artificial, pinch, tapped, semi, feedback | The fretted note raised by the overtone at `value` frets from it (12 when absent), with the same shelf.                                                                                                                                                                   |
| `staccato`                                           | Released at half the note's length.                                                                                                                                                                                                                                       |
| `letRing`                                            | Rings to the next note on its string or `barEnd`, whichever comes first.                                                                                                                                                                                                  |
| `Beat.effects.fadeIn`, `fadeOut`                     | Level from -48 dB to 0 (or back) across the beat, linear in dB.                                                                                                                                                                                                           |
| `Beat.effects.volumeSwell`                           | -48 dB to 0 at half the beat and back to -48 dB at its end.                                                                                                                                                                                                               |
| `Beat.grace`                                         | Played by the sink with their own effects: grace notes `before` end on the beat (squeezed into a quarter note, the scheduler's lead); on-beat ones start on it and delay the main note (squeezed into half the beat).                                                     |
| `tie`                                                | The scheduler folds the chain into the origin. A bend on the origin spans the whole tied length when no later link bends on its own, as Guitar Pro plays it (`PlanInput.bendLength`); the links' own effects are #72.                                                     |
| `Beat.mix` volume, pan                               | From `mix`, scheduled on the strip at the beat (`setTrack(..., { at, ramp })`), a linear glide over `duration` quarter notes when given; `allTracks` applies it to every track. Rests and tied continuations included.                                                    |
| `Beat.mix` program                                   | From `mix`, the track's instrument switches at the beat (`setInstrument(..., at)`) to the sink's `instrumentOf(track, program)`; notes already sounding keep theirs. Rests and tied continuations included; replayed at a run start.                                      |

On drum tracks only velocity (dynamics, accents, ghost), fades, trills and tremolo apply; drum
articulation variants (rim shot, choke) arrive from the readers already mapped to their GM note.
Pitched tracks take everything, but a harmonic changes the pitch only on a fretted track, which
has the open string it needs.

### Measured (`articulations.test.ts`, the engine driving the real sampler, tapped before the bus)

| Property                            | Measured                                                           |
| ----------------------------------- | ------------------------------------------------------------------ |
| Full bend, held part                | 2 semitones up, 0.00001 cent off                                   |
| Natural harmonics at 12, 7, 5, 4    | 2, 3, 4, 5 × the open string within 0.0001 cent                    |
| Palm mute, energy above 2 kHz       | 0.033 × the unmuted note's                                         |
| Tie                                 | one onset                                                          |
| Hammer-on                           | -3.2 dB against the picked note before it                          |
| Shift and legato slide              | 197 cents of 200 at 1 ms before the next onset; on pitch after it  |
| Legato vs shift, level at the onset | ×0.84 (still decaying) vs ×17.9 (struck again)                     |
| Vibrato slight, wide                | 5.5 Hz ±25.0 cents, 5 Hz ±60.0 cents                               |
| Trill (32nds), tremolo (16ths)      | 8 and 8 onsets, each within 0.06 ms of the grid                    |
| Dead note                           | a 35 ms burst; the note's pitch carries 3% of its level            |
| Staccato quarter at 120 BPM         | silent 292 ms after the onset (release at 250 ms)                  |
| Beat volume change to 50            | lands 5 ms after the beat (the strip's smoothing), ×0.25 the level |

### What the HQ tier will override (WP-093)

The filter and envelope paths above are ADR-0004's fallback for packs without articulation
samples. The sink passes no `layer` yet. WP-093 adds it for packs that carry `palmMute`,
`harmonic`, `dead` or legato layers (the sampler already resolves `layer`, falling back to the
default layer), and drops the matching filter or envelope here when the layer exists: a sampled
palm mute through a 900 Hz low-pass is muted twice. The dead note's noise burst gives way to the
pack's dead-note region, and the hammer-on's 20 ms offset to its legato layer. Bends, slides,
vibrato, trills, tremolo, dynamics and fades stay automation in both tiers.

### Known and deliberate

- **Effects written on a tied link are not played yet** (#72). The event carries the links as
  `continuations`, but the planner reads the origin's effects only, so a bend or vibrato written
  on a later link is lost. The one rule already in place is the bend span above.
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
source.memory(); // the engine's MemoryReport: { decodedBytes, budgetBytes, residents }
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

### Planning and preload

`planInstruments` walks the playback sequence, not written order, so a `Beat.mix` program change
reached through a repeat or a jump is attributed to the bars it actually sounds in. Each track
plans its own program even when it has no notes (it costs nothing until a note asks for it).
Keys are the ones the sink strikes: the note's sounding key rounded (`soundingKey`, so a harmonic
plans the overtone it plays, not the fretted key), plus grace notes and the trill's alternate fret.
`planSamples` takes every layered region of a key (`resolveAll`).

`load` decodes every sample the opening `bars` (default 4) can reach before it resolves, at every
velocity and in every articulation layer, since dynamics and articulations are the scheduler's
to decide. It then warms the rest of the song in the background, four fetches at a time, but only
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

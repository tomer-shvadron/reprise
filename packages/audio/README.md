# @reprise/audio

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

`createSamplerSink(sampler)` adapts the sampler to the scheduler's sink shape
(`noteOn(track, note, beat, when, duration, letRingUntil?)`, `noteOff`, `allNotesOff`); it is to
be reconciled with WP-030's `InstrumentSink` when both land. `letRingUntil` is where the scheduler
puts the end of the bar for a let-ring note. The sink keeps a handle per note only until the voice
can no longer sound (`held` says how many), so a long song does not accumulate them.

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
  loop?: { start: number; end: number };
  byteLength: number;
}

interface SampleProvider {
  instrumentOf(ref: SampleRef): InstrumentId; // the unit of eviction
  fetch(ref: SampleRef): Promise<RawSample>; // raw PCM; the manager builds the AudioBuffer
  byteLength(ref: SampleRef): number; // decoded size estimate, reserved before the fetch
}
```

The loop points a sampler voice uses are on its `Region`; an `AudioBuffer` has nowhere to carry
them, so the manager does not read `RawSample.loop`.

### API

```ts
const source = new ManagedSampleSource(provider, context, { budgetBytes: GM_BUDGET_BYTES });
const plan = await source.load(score, regionMapOf, { bars: 4 }); // AudioEngine.load's half
source.memory(); // { decodedBytes, budgetBytes, residents }
const off = source.on('memory', (stats) => {}); // coalesced to one per animation frame
source.budgetBytes = 300 * MEGABYTE; // settable at runtime; lowering it evicts at once
source.counters; // { fetches, evictions, pinnedEvictions }

planInstruments(score, { bars?, instrumentOf? }); // instruments and keys per track
planSamples(plan, regionMapOf); // the SampleRefs those keys reach
```

### Accounting, eviction and pinning

- **Accounting** is per buffer, `numberOfChannels × length × 4` bytes, from the buffer built and
  not from the provider's estimate. The estimate only reserves room while a fetch is in flight,
  so a burst of loads (a preload) evicts ahead and cannot overshoot.
- **Eviction is by whole instrument**, least recently used first, whenever resident plus
  reserved bytes exceed the budget. Recency is `peekBuffer`, which the sampler calls for every
  note it starts, and `getBuffer`. Half an instrument would save little and turn into skipped
  notes all over its range.
- **Pinning.** `switchSong` (and so `load`) pins the instruments the new song uses and evicts
  every other one at once. A leftover loaded afterwards (an editor preview on a new track, a
  program change the plan did not see) is evicted before any pinned instrument, however recent.
- **The instrument being loaded is never its own victim**, so the budget is exceeded only when
  that one instrument is larger than the whole budget.

### Planning and preload

`planInstruments` walks the playback sequence, not written order, so a `Beat.mix` program change
reached through a repeat or a jump is attributed to the bars it actually sounds in. Each track
plans its own program even when it has no notes (it costs nothing until a note asks for it).
Keys come from `midiNote`, plus grace notes and the trill's alternate fret.

`load` decodes every sample the opening `bars` (default 4) can reach before it resolves, at every
velocity and in every articulation layer, since dynamics and articulations are the scheduler's
to decide. It then warms the rest of the song in the background, but only if all of it fits the
budget: otherwise warming would evict what the opening bars need.

### The degrade path

Below the needs of the current song nothing throws. Pinned instruments are evicted least
recently used first (`counters.pinnedEvictions` counts them); the sampler finds a non-resident
sample, skips the note, reports it through `onMiss` and requests the load, so the next note on
it plays. `memory()` shows the overrun, so the settings can say why.

### Budgets, measured

`memory-budget.test.ts` runs the reference long score (8 tracks, 300 bars, with structure)
against a synthetic provider sized like GeneralUser GS decoded to Float32 (1 to 4 MB per
instrument with every zone resident, a zone every 3 semitones), under the GM budget of 80 MB:

| Case                                 | Result                                                   |
| ------------------------------------ | -------------------------------------------------------- |
| `planInstruments`, 8 × 300           | about 15 ms                                              |
| Song A, 8 guitar and bass programs   | 5.7 MB resident, 0 misses in 62,124                      |
| Song B after A, 7 programs and a kit | 5.9 MB resident (shared instrument kept whole), 0 misses |
| Every zone of song A's 8 instruments | 21.3 MB                                                  |
| Song A under half its needs (2.8 MB) | peak 2.8 MB, notes skipped and reloaded, nothing thrown  |

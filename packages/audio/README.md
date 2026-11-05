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
`keynumToVolEnvHold` and `keynumToVolEnvDecay` are expanded to one region per key (see
[SF2 loader and GM tier](#sf2-loader-and-gm-tier), which has the full mapping).

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

## SF2 loader and GM tier

In `src/sf2/`: a SoundFont 2 parser, the resolution of presets into `Region`s, and
`Sf2Soundfont`, which implements the memory manager's `SampleProvider` seam over one bank.

```ts
const font = Sf2Soundfont.parse(bytes); // headers only; the PCM stays in `bytes`
font.regionMapFor(bank, program); // RegionMap | undefined; the bank falls back to 0
font.drumKitRegionMap(kit); // bank 128; a missing kit falls back to kit 0
font.preset(bank, program); // exact: { id, name, regions, bytes, report }
font.instrumentOf(ref); // 'gm:0:25', 'gm:drums:0': whole-instrument eviction groups
font.byteLength(ref); // decoded Float32 size, before any fetch
await font.fetch(ref); // { sampleRate, channels: Float32Array[], loop (frames), byteLength }
```

**Our own parser, not a library.** The candidates were `soundfont2` (MIT, last released in
October 2024) and SpessaSynth's parser, which ADR-0004 already set aside. Neither resolves
generators into the shape the `Region` needs, so that layer, the bulk of the work, would be ours
either way; what remains is the RIFF walk plus fixed-size records, and owning it keeps the PCM a
view over the file until `fetch`, with no dependency to audit. It reads `INFO`, `sdta` (`smpl` and, from version 2.04,
`sm24`) and `pdta`'s nine sub-chunks, uses only `DataView` and `TextDecoder`, so it runs in Node
as well, and builds no `AudioBuffer`: decoding into one is the memory manager's job.

**Lazy decode.** Parsing records where each sample's PCM sits; nothing is converted. `fetch`
converts one slice of 16-bit PCM (with the `sm24` low byte when present) to Float32 channels. A
sample ref carries everything `fetch` needs, so the provider keeps no table of issued refs:
`<instrument>/<shdr index>[+<right index>]/<start>-<end>[/<loop start>-<loop end>]`, absolute
frames into `smpl` after the zone's address offsets. Refs are scoped to their preset, so
`instrumentOf` is unambiguous and evicting one instrument never pulls a sample from under
another; the cost is that two presets sharing a sample decode it twice when both are loaded.

**Resolution.** A preset zone names an instrument, whose zones name samples. Within each level a
local zone's generators replace its global zone's. Preset values are then added to the
instrument's as offsets, the sum clamped to the spec's range; key and velocity ranges intersect
instead, and the generators the spec reserves for instruments (addresses, `sampleModes`,
`exclusiveClass`, `overridingRootKey`, `keynum`, `velocity`) are ignored at preset level.

| SF2 generator                                                                   | `Region`                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keyRange`, `velRange`                                                          | `keyLo`..`keyHi`, `velLo`..`velHi`: the instrument zone's range intersected with the preset zone's; an empty intersection drops the zone                                  |
| `overridingRootKey`, else `shdr.originalPitch`                                  | `rootKey`; an `originalPitch` of 255 (unpitched) reads as 60                                                                                                              |
| `coarseTune`, `fineTune`, `shdr.pitchCorrection`                                | `tune` = coarse × 100 + fine + correction, in cents                                                                                                                       |
| `scaleTuning` ≠ 100                                                             | one region per key, `rootKey` = key, `tune` = scale × (key − root) + the cents above: exact                                                                               |
| `sampleModes` 1 and 3                                                           | `loop`, in seconds from the slice start; 3 (loop until release) as a plain loop. 0 and 2 play once                                                                        |
| address offsets (`start`, `end`, `startloop`, `endloop`, fine + 32768 × coarse) | the slice the ref names and the loop inside it; a loop starting before the start offset cannot live in the slice and is dropped (reported)                                |
| `attackVolEnv`, `holdVolEnv`                                                    | `envelope.attack`, `.hold`: 2^(timecents / 1200) seconds                                                                                                                  |
| `sustainVolEnv`                                                                 | `envelope.sustain` = 10^(−cB / 200); 1000 cB (100 dB) and more is 0                                                                                                       |
| `decayVolEnv`                                                                   | `envelope.decay` = SF2 time × min(sustain dB, 80) / 100: SF2 times a full 100 dB fall at a constant dB rate, the sampler the fall to the sustain level, or -80 dB at most |
| `releaseVolEnv`                                                                 | `envelope.release` = SF2 time × 80 / 100, the sampler's release ending at -80 dB; exact from full level, slower from a lower one                                          |
| `keynumToVolEnvHold`, `keynumToVolEnvDecay`                                     | one region per key, with hold and decay at timecents + factor × (60 − key): exact                                                                                         |
| `initialAttenuation`                                                            | `attenuation` = cB / 10 dB, positive quieter                                                                                                                              |
| `pan`                                                                           | `pan` = value / 500, mono regions only                                                                                                                                    |
| linked left and right samples                                                   | one region with a two-channel ref, left first (below)                                                                                                                     |

**Stereo merge.** A zone whose sample is a left or right half, with a zone in the same instrument
playing its linked partner over exactly the same key and velocity ranges, becomes one region whose
ref names both samples, left first; `fetch` returns two channels and the voice plays them
unpanned. The left zone's generators win and a right zone that differs in any of them is counted
in `report.stereoMismatches`. A half without such a partner stays a mono region with its own pan.

**What the `Region` cannot carry is reported, never approximated.** `preset().report` counts,
per preset, the zones with a non-neutral value for each generator the `Region` has no field for
(filter, modulation and vibrato LFOs, modulation envelope, effects sends, `delayVolEnv`,
`exclusiveClass`, `keynum`, `velocity`), zones under non-default modulators, zones expanded per
key, overlapping regions (`layered`), stereo mismatches, and dropped zones and loops.

### GeneralUser GS

`pnpm sounds:fetch` (`scripts/sounds/fetch-gm.ts`) downloads GeneralUser GS 2.0.3 and its
license from the author's GitHub repository, pinned by commit in `scripts/sounds/gm.json`,
verifies both by SHA-256, and writes them to `apps/web/public/sounds/gm/`, where only the README
is committed (it has the provenance and the license summary). CI caches the files on the pins and
fetches them on a miss, so the GeneralUser GS suite (`src/sf2/general-user-gs.test.ts`) runs
there; locally it skips with a message until the files are fetched.

Measured over the GM set (bank 0 programs 0 to 127 and the standard kit, 129 presets):

- Every program and every GM percussion key, 35 to 81, resolves. 16,100 regions, 1,434 sample
  refs.
- Decoded as Float32 the whole GM set is 121.6 MiB; deduplicated across presets it would be
  71.5 MiB, and the whole sample chunk 61.2 MiB. A median preset is 0.41 MiB; the largest are
  the string sections at 8.93 MiB each (they share their samples) and the standard kit at
  5.49 MiB.
- The file is version 2.01: no `sm24`, and no linked stereo samples at all (all 920 are mono), so
  the stereo merge is for other banks.
- It uses the key-scaled envelope generators heavily: `keynumToVolEnvHold` in 287 zones and
  `keynumToVolEnvDecay` in 676, `scaleTuning` in 156. All are expanded per key, exactly.
- It needs what the `Region` lacks, tracked in
  [#61](https://github.com/tomer-shvadron/reprise/issues/61): 70 presets layer more than one zone
  per key, which the sampler plays as one; 6,458 zone instances set a low-pass filter (median
  about 800 Hz); 14 zones have an audible volume-envelope delay; 27 set an exclusive class. It
  also uses non-default modulators in 4,215 zones, which nothing applies.
- Three zones (Soundtrack, Birds) start past their loop start and play unlooped.

The fixture the parser tests run on is `test-fixtures/synthetic.sf2`, about 3 KB, written by
`pnpm sounds:fixture` (`scripts/sounds/make-test-sf2.ts`); a scripts test fails when the committed
file and the generator disagree.

# ADR-0004: One sampler engine of our own, fed by SF2 and SFZ loaders

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

Guitar Pro's realistic sound engine is multi-sampled instruments with articulation layers
run through an effects chain. Two sound tiers are wanted: a plain General MIDI tier, which is
what Guitar Pro's non-RSE mode is, and a high-quality tier with sampled instruments and
effects. The owner asked how to get sounds like Guitar Pro's and raised memory management as
a priority.

Research during the session established that free material exists for both tiers. A General
MIDI soundfont covers every instrument in one file: GeneralUser GS at about 30 MB, or
FluidR3 at about 140 MB. Per-instrument libraries in SFZ format, a plain-text file mapping
key and velocity ranges to individual wav or flac samples, exist for electric guitar
(Unreal Instruments' Standard Guitar and Metal GTX, Karoryfer's Emilyguitar), bass
(Karoryfer's CC0 Black and Blue Basses and Swagbass), drums (Salamander Drumkit, SM Drums),
piano (Salamander Grand Piano) and orchestral instruments (Sonatina Symphonic Orchestra).
Acoustic guitar is the weak spot. Sources and licenses are tracked in
`../reference/sound-packs.md`.

Two requirements argue against borrowing an existing synthesizer such as SpessaSynth:

- Guitar needs **per-voice pitch control**. Two strings can bend by different amounts at the
  same time; MIDI-style synthesizers bend per channel.
- The owner wants **fine-grained memory eviction**, which a library that loads a whole
  soundfont does not give.

Mixing is not the bottleneck: Web Audio mixes on a native audio thread, and starting a sample
is one native node. Memory for decoded audio is the real budget, since decoded PCM is 32-bit
float at roughly 176 KB per second of mono audio at 44.1 kHz.

## Decision

- **One sampler engine, owned by Reprise**, in the `audio` package: region lookup by key and
  velocity, voice allocation and stealing, per-voice gain and detune automation, envelopes,
  loop points, lazy sample fetch and decode, and an eviction policy.
- **Two loaders producing the same in-memory region map**: an SF2 loader for the General
  MIDI tier and an SFZ loader for the HQ tier. The SF2 loader consumes only the subset
  needed: samples, key and velocity ranges, root pitch, loop points, envelopes.
- **GeneralUser GS is the bundled GM soundfont** (default unless revisited): about 30 MB and
  redistributable.
- **Effects are native Web Audio nodes**: WaveShaper for overdrive and distortion, Convolver
  for cabinet impulse responses and reverb, Biquad filters for EQ and wah, Delay, a
  compressor, and a modulated delay for chorus and flanger. Effect presets (clean, overdrive,
  distortion) are derived from a track's GM program by default.
- **Articulations are engine behaviour, not samples**: bends are a detune ramp, slides a
  glide, vibrato an LFO on detune, let-ring a suppressed note-off, hammer-ons a retrigger
  without attack, dead notes a short noise burst; palm mute and harmonics use a separate
  sample layer where the library has one and a filter plus short envelope where it does not.
- **Sample data never lives in git.** The app has a sound library screen with a manifest per
  pack; packs whose license permits are downloaded by the app, the rest are imported from a
  zip the user obtains. Decoded audio lives only in memory under the budget of ADR-0005.

## Alternatives considered

- **SpessaSynth for everything** (a JavaScript SF2/SF3/DLS synthesizer running in an
  AudioWorklet): mature and MIDI-complete, but channel-level pitch bend and whole-soundfont
  loading conflict with the two requirements above.
- **SpessaSynth for the GM tier, our sampler for HQ**: two scheduling paths, two memory
  models, and bends behaving differently between tiers. Rejected in favour of one engine.
- **A generic sampler library** (the session's earlier suggestion): reversed for the same
  two reasons.

## Consequences

- The SF2 loader is the extra cost of the one-engine choice; it is bounded by the subset
  consumed.
- Articulations work identically in both tiers because they are implemented once, above the
  loaders.
- The scheduler runs on the main thread with lookahead; moving it into an AudioWorklet is a
  documented mitigation if main-thread jank ever produces gaps, not a v1 requirement.
- Cabinet impulse responses from free packs are "free to use", not always "free to
  redistribute", so they follow the same download-or-import path as sample packs.

## Related

- `../specs/shared-understanding.md`
- `../reference/sound-packs.md`
- `0002-hybrid-build-vs-assemble.md`
- `0005-memory-budgets-lazy-loading.md`

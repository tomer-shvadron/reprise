# ADR-0027: SF2 attenuation follows FluidSynth, note-on modulators are applied, the master bus ends in a soft ceiling

- **Status**: Accepted
- **Date**: 2026-11-15
- **Deciders**: Tomer Shvadron, with Claude

## Context

Issue #169: playback was barely audible with the master, track and system volume at maximum. A
steel-guitar note at forte peaked at -33.5 dBFS, a band mix's loudest 3 s sat near -25 dBFS RMS,
and a metronome accent was 40 dB louder than the music. Measurement found two losses in the SF2
loader, both departures from how GeneralUser GS (GU GS) is voiced, which is for FluidSynth:

1. `initialAttenuation` was applied at full scale. FluidSynth, like EMU hardware, scales the
   generator by 0.4 when loading it ("most existing soundfonts expect exactly this (strange,
   non-standard) behaviour"). GU GS regions played 0.6 of their attenuation too quiet: -9.8 dB on
   the steel guitar, -10.8 dB on the piano, and secondary layers (35 to 50 dB of attenuation)
   vanished.
2. SF2 modulators were ignored, and the modulation envelope's share of the filter was frozen at
   its sustain level. GU GS opens its filters with `modEnvToFilterFc` and a velocity to
   `modEnvToFilterFc` modulator, then lets them close slowly; frozen at sustain, a distortion
   guitar sat behind a 200 Hz low-pass where FluidSynth starts at about 11 kHz. The soundfont
   also overrides the default velocity curve in hundreds of zones.

Ruled out: the track volume import, the channel volume curve ((v/127)^2 is FluidSynth's default
CC7 modulator), the master volume, a doubled attenuation, a missing gain stage for many voices,
and any web or desktop difference. The limiter was a separate finding: with extra gain ahead of
it, the DynamicsCompressor let peaks through at +0.6 to +2.4 dBFS.

## Decision

- **`initialAttenuation` is scaled by 0.4**, as FluidSynth and EMU do. The factor applies to the
  summed preset and instrument generator; the resonance cut and modulator contributions are not
  scaled. The result is clamped to 0..144 dB. This departs from the letter of the SF2
  specification on purpose.
- **Note-on modulators are applied.** The parser keeps the `pmod`/`imod` records. Sources
  velocity, key and none are supported, with the four curves, both polarities and both
  directions; destinations are `initialAttenuation`, `initialFilterFc`, `modEnvToFilterFc` and
  `initialFilterQ`. FluidSynth's default modulator for velocity to attenuation (the MIDI curve)
  is the base. Its velocity to cutoff default is defined but inert in FluidSynth
  (`fluid_mod_get_value` returns 0 for that identity, a change by GU GS's author), so it is not
  applied here either, nor is a modulator with its identity; GU GS's own velocity to cutoff
  modulators have another identity and apply. Instrument-level modulators
  replace a default of the same identity, preset-level ones add to it (SF2 2.04 9.5). Controller,
  pressure and linked modulators and effect sends are skipped and counted in
  `PresetReport.modulated`. A region from a soundfont carries its merged modulators; one without
  (SFZ, test instruments) keeps the plain MIDI velocity curve.
- **The modulation envelope drives the region filter over time**: the cutoff rests at
  `initialFilterFc`, then follows delay, attack, hold and decay to its sustain share of
  `modEnvToFilterFc`, as an exponential ramp in hertz because the envelope is linear in cents.
  The release phase is not modelled.
- **The master bus ends in a soft ceiling** after the master gain: the identity up to -1 dBFS and
  a tanh towards -0.2 dBFS above it, on an odd-length curve so silence stays exactly zero, with no
  oversampling so no latency is added. It catches the limiter's 1 ms overshoot; nothing below
  -1 dBFS changes.
- **No makeup gain.** A fixed makeup pushed dense mixes into the limiter and over full scale. The
  levels now match FluidSynth at `synth.gain = 1.0`, the setting the GU GS author's own guide
  uses. The volume controls are unchanged: master is linear after the limiter, track volume
  follows the GM curve, and `test/loudness.test.ts` pins the levels and the controls.

## Alternatives considered

- **A fixed makeup gain** to reach a target loudness. Rejected: it hides the two defects, and a
  band mix then clips or is limited constantly.
- **A hard clip or a lower limiter threshold instead of the ceiling.** A clip adds harsh
  distortion on rare overs; a lower threshold changes the sound of every note. The ceiling is
  transparent below -1 dBFS.
- **Treating attenuation per the spec and boosting the soundfont's output instead.** That would
  keep the spec's letter but make every soundfont voiced for EMU hardware wrong in its layer
  balance, which the 0.4 factor fixes at the source.
- **Full SF2 modulator support** (controllers, pressure, links, effect sends). Out of scope: no
  effects bus exists yet, and the supported subset covers every loudness and brightness
  modulator GU GS uses.

## Consequences

- Every GM region is louder by 0.6 of its attenuation: about 7 to 11 dB on main layers and up to 30 dB on secondary ones, so layered regions sound balanced as designed. The
  numbers in `test/loudness.test.ts` are measured with GU GS 2.0.3; a soundfont bump re-measures
  them.
- A bright filter envelope now plays over time, so distortion and steel guitars have their attack
  back. The attack verification thresholds of #159 are retuned from the new numbers.
- `pnpm check:files` can no longer raise `peak-over-1`: the ceiling holds the output under
  -0.2 dBFS.
- The `Region` shape gains `filter.envelope` and `modulators`; `PresetReport.modulated` now counts
  zones with an unapplied modulator, and `modEnvToFilterFc` leaves `unsupported`.

## Related

- `0004-own-sampler-engine-two-loaders.md`
- `0005-memory-budgets-lazy-loading.md`

import { test } from 'vitest';

import { Sampler } from '../sampler/sampler';
import type { SamplerTrack } from '../sampler/sampler';
import { sineInstrument } from '../sampler/test/offline';
import { realtimeDefer } from './bypass-slot';
import { stagesOf } from './presets';
import type { EffectPresetId } from './presets';
import { ImpulseBank, ReverbBus } from './reverb-bus';

/**
 * CPU of the effects chain, with no budget (the budgets table has no audio time row; the lead
 * decides whether to add one). Each iteration renders 10 s offline at 44.1 kHz of sustained
 * three-note chords on every track, so the render's wall time over 10 s is the cost relative to
 * realtime: an offline render runs the convolvers inline, a pessimistic proxy for the audio thread.
 */
const SECONDS = 10;
const SAMPLE_RATE = 44_100;
const RUN = { iterations: 5, time: 0, warmupIterations: 1, warmupTime: 0 };
const BENCH = { timeout: 300_000 };
const CHANNEL = { volume: 127, pan: 64, chorus: 0, reverb: 0, phaser: 0, tremolo: 0 };

function track(id: string): SamplerTrack {
  return {
    id,
    kind: 'pitched',
    tuning: [],
    capo: 0,
    channel: { ...CHANNEL, mute: false, solo: false },
  };
}

/** `separateReverb` gives every strip a bus of its own: the design the shared bus replaced. */
async function renderSong(
  tracks: number,
  preset: EffectPresetId | undefined,
  separateReverb = false,
): Promise<void> {
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: SECONDS * SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
  });
  const sampler = new Sampler(context, { defer: realtimeDefer(context) });
  const bank = new ImpulseBank(context);
  for (let i = 0; i < tracks; i += 1) {
    const id = `t${String(i)}`;
    const strip = sampler.addTrack(track(id), sineInstrument(undefined, SECONDS));
    if (preset) {
      sampler.setEffects(id, stagesOf(preset));
      if (separateReverb) {
        const own = new ReverbBus(context, bank, sampler.master.input);
        const send = strip.reverbSend;
        send?.disconnect();
        send?.connect(own.input);
      }
    }
    for (let note = 0; note < 4; note += 1) {
      for (const key of [57 + (i % 7), 64 + (i % 5), 69]) {
        sampler.noteOn(id, {
          key,
          velocity: 90,
          when: note * 2.5,
          letRing: { until: note * 2.5 + 2.4 },
        });
      }
    }
  }
  await context.startRendering();
}

const ROWS: { name: string; preset: EffectPresetId | undefined; separateReverb?: boolean }[] = [
  { name: 'no chain', preset: undefined },
  { name: 'distortion chains, shared reverb', preset: 'distortion' },
  { name: 'clean chains (chorus), shared reverb', preset: 'clean' },
  { name: 'overdrive chains (delay), shared reverb', preset: 'overdrive' },
  { name: 'reverb only (keys), shared reverb', preset: 'keys' },
  { name: 'distortion chains, a reverb per track', preset: 'distortion', separateReverb: true },
];

for (const tracks of [8, 16]) {
  for (const { name, preset, separateReverb } of ROWS) {
    const metric = `${String(tracks)} tracks: ${name}`;
    test(metric, BENCH, async (context) => {
      const result = await context
        .bench(metric, async () => {
          await renderSong(tracks, preset, separateReverb);
        })
        .run(RUN);
      const p50 = result.latency.p50;
      await context.annotate(
        `${metric}: p50 ${p50.toFixed(0)} ms for ${String(SECONDS)} s of audio, ${((SECONDS * 1000) / p50).toFixed(1)}x realtime, no budget`,
      );
    });
  }
}

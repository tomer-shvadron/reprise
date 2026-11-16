import { test } from 'vitest';

import { Sampler } from '../sampler/sampler';
import type { SamplerTrack } from '../sampler/sampler';
import { sineInstrument } from '../sampler/test/offline';
import { checkBudget, recordMeasurement } from '../test/budget';
import { realtimeDefer } from './bypass-slot';
import { stagesOf } from './presets';
import type { EffectPresetId } from './presets';

/**
 * The CPU of the effects chains: 16 tracks, each with a three-note chord every 1.25 s, rendered
 * offline for 5 s at 44.1 kHz. The render's wall time is the cost of the song; an offline render
 * runs the convolvers inline, so it is a pessimistic proxy for the audio thread. The first row has
 * a budget in the roadmap's table; the second, the same song with no chain, is only reported.
 */
const SECONDS = 5;
const TRACKS = 16;
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

async function renderSong(preset: EffectPresetId | undefined): Promise<void> {
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: SECONDS * SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
  });
  const sampler = new Sampler(context, { defer: realtimeDefer(context) });
  for (let i = 0; i < TRACKS; i += 1) {
    const id = `t${String(i)}`;
    sampler.addTrack(track(id), sineInstrument(undefined, SECONDS));
    if (preset) sampler.setEffects(id, stagesOf(preset));
    for (let note = 0; note < 4; note += 1) {
      for (const key of [57 + (i % 7), 64 + (i % 5), 69]) {
        sampler.noteOn(id, {
          key,
          velocity: 90,
          when: note * 1.25,
          letRing: { until: note * 1.25 + 1.2 },
        });
      }
    }
  }
  await context.startRendering();
}

const BUDGETED =
  'Effects: 16 tracks of distortion chains and the shared reverb, 5 s rendered offline';

test(BUDGETED, BENCH, async (context) => {
  const result = await context
    .bench(BUDGETED, async () => {
      await renderSong('distortion');
    })
    .run(RUN);
  await checkBudget(context, BUDGETED, result.latency.p50, { enforced: true });
});

// The same song with no chain, for the cost of the chains against the voices and the master bus.
test('Effects: 16 tracks with no chain, 5 s rendered offline', BENCH, async (context) => {
  const metric = 'Effects: 16 tracks with no chain, 5 s rendered offline';
  const result = await context
    .bench(metric, async () => {
      await renderSong(undefined);
    })
    .run(RUN);
  await recordMeasurement(context, metric, result.latency.p50);
});

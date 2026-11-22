import { describe, expect, it } from 'vitest';

import { ARTICULATION } from '../articulations/parameters';
import { bandEnergy, signalOf } from '../test/signal';
import type { Signal } from '../test/signal';
import { WahPedal } from './wah';

const SAMPLE_RATE = 44_100;
const { closed, open } = ARTICULATION.wah;

/** A deterministic white noise, uniform in -1..1. */
function noise(seconds: number): AudioBuffer {
  const buffer = new AudioBuffer({
    length: Math.round(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const data = buffer.getChannelData(0);
  let seed = 12_345;
  for (let i = 0; i < data.length; i += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    data[i] = (seed / 2 ** 32) * 2 - 1;
  }
  return buffer;
}

/** Renders `source` through a pedal that `script` drives, or straight to the output without one. */
async function render(
  seconds: number,
  source: (context: OfflineAudioContext) => AudioScheduledSourceNode,
  script?: (pedal: WahPedal) => void,
): Promise<Signal> {
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.round(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const node = source(context);
  if (script) {
    const pedal = new WahPedal(context);
    script(pedal);
    node.connect(pedal.input);
    pedal.output.connect(context.destination);
  } else {
    node.connect(context.destination);
  }
  node.start(0);
  return signalOf(await context.startRendering());
}

function noiseSource(seconds: number) {
  return (context: OfflineAudioContext): AudioScheduledSourceNode => {
    const node = context.createBufferSource();
    node.buffer = noise(seconds);
    return node;
  };
}

/** The centre of the sixth-octave band (from 40 Hz) with the most energy per root hertz. */
function loudestBand(signal: Signal, from: number, to: number): number {
  let best = { centre: 0, density: -1 };
  for (let band = 0; band < 40; band += 1) {
    const low = 40 * 2 ** (band / 6);
    const high = 40 * 2 ** ((band + 1) / 6);
    const density = bandEnergy(signal, low, high, from, to) / Math.sqrt(high - low);
    if (density > best.density) best = { centre: Math.sqrt(low * high), density };
  }
  return best.centre;
}

describe('WahPedal', () => {
  const near = (centre: number, target: number): boolean =>
    Math.abs(Math.log2(centre / target)) < 1 / 6;

  it('moves the filter peak as marked, and gives the dry signal back when off', async () => {
    const seconds = 1.6;
    const wet = await render(seconds, noiseSource(seconds), (pedal) => {
      pedal.set('closed', 0);
      pedal.set('open', 0.5);
      pedal.set('off', 1);
    });
    const dry = await render(seconds, noiseSource(seconds));

    expect(near(loudestBand(wet, 0.1, 0.4), closed)).toBe(true);
    expect(near(loudestBand(wet, 0.7, 0.95), open)).toBe(true);
    // The noise itself is flat: dry has no such peak, so the peaks above are the pedal's.
    expect(near(loudestBand(dry, 0.1, 0.4), closed)).toBe(false);
    let largest = 0;
    for (let i = Math.round(1.1 * SAMPLE_RATE); i < wet.data.length; i += 1) {
      largest = Math.max(largest, Math.abs((wet.data[i] ?? 0) - (dry.data[i] ?? 0)));
    }
    expect(largest).toBeLessThan(1e-6);
  });

  it('glides from closed to open rather than stepping', async () => {
    const seconds = 1.2;
    const signal = await render(seconds, noiseSource(seconds), (pedal) => {
      pedal.set('closed', 0, true);
      pedal.set('open', 0.5);
    });
    // 10 ms in the centre is at about 800 Hz, which leaves a tenth of the 2.2 kHz band; 300 ms in
    // (7 time constants) the band is fully open.
    const high = (from: number, to: number) => bandEnergy(signal, 2000, 2400, from, to);
    expect(high(0.505, 0.515)).toBeLessThan(0.3 * high(0.8, 0.81));
    expect(near(loudestBand(signal, 0.8, 1.1), open)).toBe(true);
  });

  it('settles a restore over about 10 ms and fades an engage in over 20 ms', async () => {
    const seconds = 0.2;
    const plain = await render(seconds, noiseSource(seconds));
    const restored = await render(seconds, noiseSource(seconds), (pedal) => {
      pedal.set('closed', 0, true);
    });
    const engaged = await render(seconds, noiseSource(seconds), (pedal) => {
      pedal.set('closed', 0);
    });
    // Above 4 kHz a closed band-pass leaves well under a tenth of the noise, makeup gain included.
    const above = (signal: Signal, from: number, to: number) =>
      bandEnergy(signal, 4000, 8000, from, to);
    // No step: the first 2 ms of a restore are still mostly the dry noise, and by 20 ms it is gone.
    expect(above(restored, 0, 0.002)).toBeGreaterThan(0.5 * above(plain, 0, 0.002));
    expect(above(restored, 0.02, 0.1)).toBeLessThan(0.5 * above(plain, 0.02, 0.1));
    // An engage is slower still: 60% of the dry noise is left at 8 ms.
    expect(above(engaged, 0, 0.008)).toBeGreaterThan(0.4 * above(plain, 0, 0.008));
  });

  it('drops a change scheduled after cancelAfter', async () => {
    const seconds = 0.8;
    const dry = await render(seconds, noiseSource(seconds));
    const cancelled = await render(seconds, noiseSource(seconds), (pedal) => {
      pedal.set('closed', 0.4);
      pedal.cancelAfter(0.2);
    });
    let largest = 0;
    for (let i = 0; i < dry.data.length; i += 1) {
      largest = Math.max(largest, Math.abs((cancelled.data[i] ?? 0) - (dry.data[i] ?? 0)));
    }
    expect(largest).toBeLessThan(1e-6);
  });
});

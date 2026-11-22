import { describe, expect, it } from 'vitest';

import { ARTICULATION } from '../articulations/parameters';
import { bandEnergy, rms, signalOf } from '../test/signal';
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

  it('applies a restore at once and fades an engage in over 20 ms', async () => {
    const seconds = 0.2;
    const plain = await render(seconds, noiseSource(seconds));
    const restored = await render(seconds, noiseSource(seconds), (pedal) => {
      pedal.set('closed', 0, true);
    });
    const engaged = await render(seconds, noiseSource(seconds), (pedal) => {
      pedal.set('closed', 0);
    });
    // The first 8 ms, above 4 kHz: a restore is the band-pass alone (about a tenth of the noise
    // after the makeup gain), an engage is still mostly the dry noise (60% at 8 ms).
    const above = (signal: Signal) => bandEnergy(signal, 4000, 8000, 0, 0.008);
    expect(above(restored)).toBeLessThan(0.2 * above(plain));
    expect(above(engaged)).toBeGreaterThan(0.4 * above(plain));
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

  it('keeps the level of a sawtooth swept to the middle of the sweep within 3 dB', async () => {
    const seconds = 0.6;
    const saw = (context: OfflineAudioContext): AudioScheduledSourceNode => {
      const node = context.createOscillator();
      node.type = 'sawtooth';
      node.frequency.value = 110;
      return node;
    };
    const dry = await render(seconds, saw);
    const swept = await render(seconds, saw, (pedal) => {
      pedal.set('closed', 0, true);
      // The geometric middle of the sweep, 940 Hz.
      pedal.filter.frequency.setValueAtTime(Math.sqrt(closed * open), 0);
    });
    const ratio = rms(swept, 0.2, 0.6) / rms(dry, 0.2, 0.6);
    expect(20 * Math.log10(ratio)).toBeGreaterThan(-3);
    expect(20 * Math.log10(ratio)).toBeLessThan(3);
  });
});

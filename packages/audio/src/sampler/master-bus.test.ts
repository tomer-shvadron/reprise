import { describe, expect, it } from 'vitest';

import { MasterBus } from './channel-strip';
import { SAMPLE_RATE } from './test/offline';

/** `amplitude` x 1 kHz sine through a bus at `gain`, and the whole rendered output. */
async function through(amplitude: number, gain = 1): Promise<Float32Array> {
  const frames = SAMPLE_RATE;
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: frames,
    sampleRate: SAMPLE_RATE,
  });
  const bus = new MasterBus(context, context.destination);
  bus.gain = gain;
  const buffer = new AudioBuffer({ length: frames, sampleRate: SAMPLE_RATE });
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1)
    data[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
  const source = new AudioBufferSourceNode(context, { buffer });
  source.connect(bus.input);
  source.start();
  const rendered = await context.startRendering();
  return rendered.getChannelData(0);
}

function peakOf(data: Float32Array, from: number): number {
  let max = 0;
  for (let i = from; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i] ?? 0));
  return max;
}

describe('MasterBus soft ceiling', () => {
  it('passes a half-scale tone exactly as the limiter alone would', async () => {
    const out = await through(0.5);
    const context = new OfflineAudioContext({
      numberOfChannels: 1,
      length: SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
    });
    // The bus's own limiter settings, without the ceiling: the reference the ceiling must not touch.
    const limiter = new DynamicsCompressorNode(context, {
      threshold: -1,
      knee: 0,
      ratio: 20,
      attack: 0.001,
      release: 0.1,
    });
    limiter.connect(context.destination);
    const buffer = new AudioBuffer({ length: SAMPLE_RATE, sampleRate: SAMPLE_RATE });
    const data = buffer.getChannelData(0);
    for (let i = 0; i < SAMPLE_RATE; i += 1) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
    }
    const source = new AudioBufferSourceNode(context, { buffer });
    source.connect(limiter);
    source.start();
    const reference = (await context.startRendering()).getChannelData(0);
    let worst = 0;
    for (const [i, sample] of out.entries()) {
      worst = Math.max(worst, Math.abs(sample - (reference[i] ?? 0)));
    }
    expect(worst).toBeLessThanOrEqual(1e-6);
  });

  it('keeps a +9.5 dBFS tone under the ceiling', async () => {
    const out = await through(3);
    expect(peakOf(out, 0)).toBeLessThanOrEqual(0.977 + 1e-6);
    for (const sample of out) expect(Number.isFinite(sample)).toBe(true);
  });

  it('keeps silence exactly silent', async () => {
    const out = await through(0);
    expect(peakOf(out, 0)).toBe(0);
  });

  it('lowers a sub-threshold tone by 6 dB at master gain 0.5', async () => {
    const full = await through(0.1);
    const half = await through(0.1, 0.5);
    const ratio = peakOf(half, 8000) / peakOf(full, 8000);
    expect(20 * Math.log10(ratio)).toBeCloseTo(-6.02, 1);
  });
});

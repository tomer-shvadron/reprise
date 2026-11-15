import { describe, expect, it } from 'vitest';

import { decodeAtNativeRate, sniffSampleHeader } from './decode';
import { SfzPack } from './pack';
import { encodeFlac, encodeWav, quantize, sine } from './test/encode';
import type { BitDepth } from './test/encode';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Worst distance between the decoded channel and the float source it was quantized from. */
function worst(decoded: Float32Array, source: Float32Array): number {
  let max = 0;
  for (let i = 0; i < source.length; i += 1) {
    max = Math.max(max, Math.abs((decoded[i] ?? 0) - (source[i] ?? 0)));
  }
  return max;
}

const CASES: { name: string; rate: number; bits: BitDepth; channels: number; flac: boolean }[] = [
  { name: 'a 22,050 Hz 16-bit WAV', rate: 22_050, bits: 16, channels: 1, flac: false },
  { name: 'a 96 kHz 24-bit stereo WAV', rate: 96_000, bits: 24, channels: 2, flac: false },
  { name: 'a 48 kHz 16-bit FLAC', rate: 48_000, bits: 16, channels: 1, flac: true },
  { name: 'a 32 kHz 24-bit stereo FLAC', rate: 32_000, bits: 24, channels: 2, flac: true },
];

describe('decodeAtNativeRate', () => {
  for (const { name, rate, bits, channels, flac } of CASES) {
    it(`keeps the native rate and the PCM of ${name}`, async () => {
      const sources = Array.from({ length: channels }, (_, c) => sine(220 * (c + 1), rate, 0.1));
      const bytes = (flac ? encodeFlac : encodeWav)(sources, rate, bits);
      const header = sniffSampleHeader(bytes);
      const buffer = await decodeAtNativeRate(bytes, header.sampleRate);
      expect(buffer.sampleRate).toBe(rate);
      expect(buffer.numberOfChannels).toBe(channels);
      expect(buffer.length).toBe(sources[0]?.length);
      // One least-significant bit of the depth: the decoder's scaling against our quantizer's.
      const lsb = 1 / 2 ** (bits - 1);
      for (const [c, source] of sources.entries()) {
        expect(worst(buffer.getChannelData(c), source)).toBeLessThanOrEqual(lsb);
        // And the integers themselves, which is what a lossless file promises.
        const ints = quantize(source, bits);
        const data = buffer.getChannelData(c);
        let off = 0;
        for (let i = 0; i < ints.length; i += 1) {
          off = Math.max(off, Math.abs((data[i] ?? 0) * 2 ** (bits - 1) - (ints[i] ?? 0)));
        }
        expect(off).toBeLessThanOrEqual(1);
      }
    });
  }

  it('leaves the caller bytes usable, since decodeAudioData detaches its input', async () => {
    const bytes = encodeWav([sine(440, 22_050, 0.05)], 22_050);
    await decodeAtNativeRate(bytes, 22_050);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect((await decodeAtNativeRate(bytes, 22_050)).length).toBe(1103);
  });

  it('serves SfzPack.fetch end to end with the default decoder', async () => {
    const files: Record<string, Uint8Array> = {
      'p.sfz': enc('<region> sample=a.wav key=60\n<region> sample=b.flac key=61\n'),
      'a.wav': encodeWav([sine(440, 22_050, 0.1)], 22_050),
      'b.flac': encodeFlac([sine(440, 48_000, 0.1), sine(330, 48_000, 0.1)], 48_000),
    };
    const pack = new SfzPack({
      id: 'x',
      files: {
        read: (path) => {
          const bytes = files[path];
          return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(path));
        },
      },
    });
    await pack.loadInstrument('p.sfz', { id: 'i' });
    const wav = await pack.fetch('sfz:x/a.wav');
    expect(wav.sampleRate).toBe(22_050);
    expect(wav.byteLength).toBe(2205 * 4);
    const flac = await pack.fetch('sfz:x/b.flac');
    expect(flac.sampleRate).toBe(48_000);
    expect(flac.channels).toHaveLength(2);
    expect(pack.byteLength('sfz:x/b.flac')).toBe(2 * 4800 * 4);
  });
});

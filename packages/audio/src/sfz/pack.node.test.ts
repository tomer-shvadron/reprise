import { describe, expect, it } from 'vitest';

import { SAMPLE_LIMITS, sniffSampleHeader } from './decode';
import type { DecodedAudio } from './decode';
import { SfzPack } from './pack';
import type { SfzFiles } from './pack';
import { encodeFlac, encodeWav, sine } from './test/encode';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('sniffSampleHeader', () => {
  it('reads the rate and channels of WAV and FLAC at several depths', () => {
    const tone = sine(440, 22_050, 0.05);
    expect(sniffSampleHeader(encodeWav([tone], 22_050))).toMatchObject({
      format: 'wav',
      sampleRate: 22_050,
      channels: 1,
    });
    expect(sniffSampleHeader(encodeWav([tone, tone], 96_000, 24))).toMatchObject({
      sampleRate: 96_000,
      channels: 2,
    });
    const flacTone = sine(440, 48_000, 0.05);
    expect(sniffSampleHeader(encodeFlac([flacTone], 48_000))).toMatchObject({
      format: 'flac',
      sampleRate: 48_000,
      channels: 1,
    });
    expect(sniffSampleHeader(encodeFlac([flacTone, flacTone], 44_100, 24))).toMatchObject({
      sampleRate: 44_100,
      channels: 2,
    });
  });

  it('reads Vorbis and Opus headers from the first Ogg page', () => {
    const page = (payload: number[]): Uint8Array =>
      Uint8Array.from([
        ...enc('OggS'),
        0,
        2,
        ...new Array<number>(20).fill(0),
        1,
        payload.length,
        ...payload,
      ]);
    const vorbis = [1, ...enc('vorbis'), 0, 0, 0, 0, 2, 0x44, 0xac, 0, 0];
    expect(sniffSampleHeader(page(vorbis))).toEqual({
      format: 'ogg',
      sampleRate: 44_100,
      channels: 2,
    });
    const opus = [...enc('OpusHead'), 1, 1, 0, 0, 0x80, 0xbb, 0, 0];
    expect(sniffSampleHeader(page(opus))).toMatchObject({ sampleRate: 48_000, channels: 1 });
  });

  it('skips chunks before fmt', () => {
    const wav = encodeWav([sine(440, 8000, 0.01)], 8000);
    const junk = Uint8Array.from([...enc('JUNK'), 4, 0, 0, 0, 1, 2, 3, 4]);
    const shifted = Uint8Array.from([...wav.subarray(0, 12), ...junk, ...wav.subarray(12)]);
    expect(sniffSampleHeader(shifted).sampleRate).toBe(8000);
  });

  it('declares the frames of a WAV data chunk and of a FLAC STREAMINFO', () => {
    expect(sniffSampleHeader(encodeWav([sine(440, 22_050, 0.1)], 22_050)).frames).toBe(2205);
    expect(sniffSampleHeader(encodeFlac([sine(440, 48_000, 0.1)], 48_000)).frames).toBe(4800);
  });

  it('refuses a WAV that is neither PCM nor float, and reads extensible and float tags', () => {
    const wav = encodeWav([sine(440, 22_050, 0.01)], 22_050);
    const tagged = (tag: number): Uint8Array => {
      const copy = wav.slice();
      new DataView(copy.buffer).setUint16(20, tag, true);
      return copy;
    };
    for (const tag of [1, 3, 0xfffe]) expect(sniffSampleHeader(tagged(tag)).format).toBe('wav');
    for (const tag of [0x02, 0x11, 0x55]) {
      expect(() => sniffSampleHeader(tagged(tag))).toThrow(/WAV format tag/);
    }
  });

  it('skips an ID3v2 tag in front of a FLAC', () => {
    const flac = encodeFlac([sine(440, 48_000, 0.05)], 48_000);
    const tag = Uint8Array.from([...enc('ID3'), 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);
    const tagged = Uint8Array.from([...tag, ...flac]);
    expect(sniffSampleHeader(tagged)).toEqual(sniffSampleHeader(flac));
  });

  it('never throws anything but Unsupported on a truncated header, whatever the offset', () => {
    const tone = sine(440, 44_100, 0.01);
    const page = (payload: number[]): Uint8Array =>
      Uint8Array.from([
        ...enc('OggS'),
        0,
        2,
        ...new Array<number>(20).fill(0),
        1,
        payload.length,
        ...payload,
      ]);
    const samples = [
      encodeWav([tone], 44_100),
      encodeFlac([tone], 44_100),
      page([1, ...enc('vorbis'), 0, 0, 0, 0, 2, 0x44, 0xac, 0, 0]),
      page([...enc('OpusHead'), 1, 1, 0, 0, 0x80, 0xbb, 0, 0]),
      Uint8Array.from([...enc('ID3'), 4, 0, 0, 0xff, 0xff, 0xff, 0xff]),
    ];
    for (const sample of samples) {
      for (let length = 0; length <= Math.min(sample.length, 120); length += 1) {
        // A view with a non-zero byteOffset, as a pooled buffer gives.
        const padded = Uint8Array.from([9, 9, 9, ...sample.subarray(0, length)]).subarray(3);
        try {
          sniffSampleHeader(padded);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect(error).not.toBeInstanceOf(RangeError);
          expect((error as Error).message).toMatch(/^Unsupported/);
        }
      }
    }
    const wav = encodeWav([tone], 44_100);
    const junk = Uint8Array.from([...enc('JUNK'), 0xff, 0xff, 0xff, 0xff]);
    const huge = Uint8Array.from([...wav.subarray(0, 12), ...junk, ...wav.subarray(12)]);
    expect(() => sniffSampleHeader(huge)).toThrow(/^Unsupported/);
  });

  it('refuses other formats and absurd rates', () => {
    expect(() => sniffSampleHeader(enc('ID3 not audio at all, MP3 tags'))).toThrow(/Unsupported/);
    expect(() => sniffSampleHeader(encodeWav([sine(1, 100, 1)], 100))).toThrow(/Unsupported/);
    expect(() => sniffSampleHeader(new Uint8Array(0))).toThrow();
  });
});

const SFZ = `
<control> default_path=s/
<group> loop_mode=one_shot
<region> sample=a.wav key=60
<region> sample=a.wav key=61
<region> sample=b.flac key=62
<region> sample=../../outside.wav key=63
`;

function pack(
  options: {
    sizes?: Record<string, number>;
    decode?: (bytes: Uint8Array, rate: number) => DecodedAudio;
    files?: Record<string, Uint8Array>;
  } = {},
) {
  const files: Record<string, Uint8Array> = {
    'p.sfz': enc(SFZ),
    'q.sfz': enc('<region> sample=s/a.wav key=1\n'),
    's/a.wav': encodeWav([sine(440, 22_050, 0.1)], 22_050),
    's/b.flac': encodeFlac([sine(440, 48_000, 0.1)], 48_000),
    ...options.files,
  };
  const reads: string[] = [];
  const io: SfzFiles = {
    read: (path) => {
      reads.push(path);
      const bytes = files[path];
      return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`No file ${path}`));
    },
    ...(options.sizes && { size: (path) => options.sizes?.[path] }),
  };
  const decoded: { rate: number }[] = [];
  const fake = (bytes: Uint8Array, rate: number): Promise<DecodedAudio> => {
    decoded.push({ rate });
    if (options.decode) return Promise.resolve(options.decode(bytes, rate));
    return Promise.resolve({
      sampleRate: rate,
      numberOfChannels: 2,
      length: 100,
      getChannelData: () => new Float32Array(100),
    });
  };
  return { pack: new SfzPack({ id: 'demo', files: io, decode: fake }), reads, decoded };
}

describe('SfzPack', () => {
  it('shares one ref per sample file and refuses paths that leave the pack', async () => {
    const { pack: p } = pack();
    const instrument = await p.loadInstrument('p.sfz', { id: 'sfz:demo:p' });
    const refs = instrument.regions.regions.map((r) => r.sample);
    expect(refs).toEqual(['sfz:demo/s/a.wav', 'sfz:demo/s/a.wav', 'sfz:demo/s/b.flac']);
    expect(instrument.report.escapedPaths).toHaveLength(1);
  });

  it('reads only SFZ text until a sample is fetched, then decodes at the file rate', async () => {
    const { pack: p, reads, decoded } = pack();
    await p.loadInstrument('p.sfz', { id: 'a' });
    expect(reads).toEqual(['p.sfz']);
    const raw = await p.fetch('sfz:demo/s/b.flac');
    expect(reads).toEqual(['p.sfz', 's/b.flac']);
    expect(decoded).toEqual([{ rate: 48_000 }]);
    expect(raw).toMatchObject({ sampleRate: 48_000, byteLength: 2 * 100 * 4 });
    expect(raw.channels).toHaveLength(2);
  });

  it('lists every instrument that references a file', async () => {
    const { pack: p } = pack();
    await p.loadInstrument('p.sfz', { id: 'a' });
    await p.loadInstrument('q.sfz', { id: 'b' });
    expect([...p.instrumentsOf('sfz:demo/s/a.wav')].sort()).toEqual(['a', 'b']);
    expect(p.instrumentsOf('sfz:demo/s/b.flac')).toEqual(['a']);
    expect(p.instrumentsOf('sfz:demo/nothing.wav')).toEqual([]);
  });

  it('estimates bytes from the file size, then reports the exact decoded size', async () => {
    const { pack: p } = pack({ sizes: { 's/a.wav': 1000, 's/b.flac': 1000 } });
    await p.loadInstrument('p.sfz', { id: 'a' });
    expect(p.byteLength('sfz:demo/s/a.wav')).toBe(2000);
    expect(p.byteLength('sfz:demo/s/b.flac')).toBe(4000);
    await p.fetch('sfz:demo/s/a.wav');
    expect(p.byteLength('sfz:demo/s/a.wav')).toBe(800);
    expect(p.byteLength('sfz:demo/s/b.flac')).toBe(4000);
  });

  it('has no estimate without a size', async () => {
    const { pack: p } = pack();
    await p.loadInstrument('p.sfz', { id: 'a' });
    expect(p.byteLength('sfz:demo/s/a.wav')).toBeNaN();
  });

  it('rejects a missing file, a ref no instrument issued and another pack or a bad file', async () => {
    const { pack: p } = pack({ files: { 's/bad.wav': enc('not audio') } });
    await p.loadInstrument('p.sfz', { id: 'a' });
    await expect(p.fetch('sfz:demo/s/missing.wav')).rejects.toThrow(/Unknown sample/);
    await expect(p.fetch('sfz:other/s/a.wav')).rejects.toThrow(/Unknown sample/);
    await expect(p.fetch('sfz:demo/../p.sfz')).rejects.toThrow(/Unknown sample/);
    const q = pack({ files: { 'x.sfz': enc('<region> sample=gone.wav key=1') } });
    await q.pack.loadInstrument('x.sfz', { id: 'x' });
    await expect(q.pack.fetch('sfz:demo/gone.wav')).rejects.toThrow(/No file/);
    const r = pack({
      files: { 'y.sfz': enc('<region> sample=bad.wav key=1'), 'bad.wav': enc('not audio') },
    });
    await r.pack.loadInstrument('y.sfz', { id: 'y' });
    await expect(r.pack.fetch('sfz:demo/bad.wav')).rejects.toThrow(/Unsupported sample format/);
  });

  describe('decode memory caps', () => {
    const flacDeclaring = (frames: number): Uint8Array => {
      const bytes = encodeFlac([sine(440, 48_000, 0.01)], 48_000);
      const view = new DataView(bytes.buffer);
      bytes[21] = ((bytes[21] ?? 0) & 0xf0) | (Math.floor(frames / 2 ** 32) & 0xf);
      view.setUint32(22, frames % 2 ** 32, false);
      return bytes;
    };
    const load = async (files: Record<string, Uint8Array>, sizes?: Record<string, number>) => {
      const made = pack({ files, ...(sizes && { sizes }) });
      await made.pack.loadInstrument('p.sfz', { id: 'a' });
      return made;
    };

    it('refuses a small FLAC whose header declares a huge decode, before decoding', async () => {
      const { pack: p, decoded } = await load({ 's/b.flac': flacDeclaring(2 ** 32 + 5) });
      await expect(p.fetch('sfz:demo/s/b.flac')).rejects.toThrow(/declared decoded size/);
      expect(decoded).toEqual([]);
    });

    it('accepts a FLAC declaring just under the cap and refuses one declaring zero', async () => {
      const ok = SAMPLE_LIMITS.decodedBytes / 4;
      const fine = await load({ 's/b.flac': flacDeclaring(ok) });
      await expect(fine.pack.fetch('sfz:demo/s/b.flac')).resolves.toBeDefined();
      const zero = await load({ 's/b.flac': flacDeclaring(0) });
      await expect(zero.pack.fetch('sfz:demo/s/b.flac')).rejects.toThrow(/declares no length/);
    });

    it('refuses a file over the size cap before reading it when the size is known', async () => {
      const { pack: p, reads } = await load({}, { 's/a.wav': SAMPLE_LIMITS.fileBytes + 1 });
      await expect(p.fetch('sfz:demo/s/a.wav')).rejects.toThrow(/file of/);
      expect(reads).toEqual(['p.sfz']);
    });

    it('checks the length again after the read, since a reader may not know the size', async () => {
      const big = new Uint8Array(SAMPLE_LIMITS.fileBytes + 1);
      const { pack: p, decoded } = await load({ 's/a.wav': big });
      await expect(p.fetch('sfz:demo/s/a.wav')).rejects.toThrow(/file of/);
      expect(decoded).toEqual([]);
    });

    it('rejects a decoded buffer over the cap so it never reaches the manager', async () => {
      const frames = SAMPLE_LIMITS.decodedBytes / 4 + 1;
      const big = pack({
        decode: () => ({
          sampleRate: 22_050,
          numberOfChannels: 1,
          length: frames,
          getChannelData: () => new Float32Array(0),
        }),
      });
      await big.pack.loadInstrument('p.sfz', { id: 'a' });
      await expect(big.pack.fetch('sfz:demo/s/a.wav')).rejects.toThrow(/decoded size of/);
      expect(big.pack.byteLength('sfz:demo/s/a.wav')).toBeNaN();
    });
  });

  it('refuses a pack id with a slash', () => {
    expect(
      () => new SfzPack({ id: 'a/b', files: { read: () => Promise.resolve(new Uint8Array()) } }),
    ).toThrow(RangeError);
  });
});

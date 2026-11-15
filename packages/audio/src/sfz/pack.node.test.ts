import { describe, expect, it } from 'vitest';

import { sniffSampleHeader } from './decode';
import type { DecodedAudio } from './decode';
import { SfzPack } from './pack';
import type { SfzFiles } from './pack';
import { encodeFlac, encodeWav, sine } from './test/encode';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('sniffSampleHeader', () => {
  it('reads the rate and channels of WAV and FLAC at several depths', () => {
    const tone = sine(440, 22_050, 0.05);
    expect(sniffSampleHeader(encodeWav([tone], 22_050))).toEqual({
      format: 'wav',
      sampleRate: 22_050,
      channels: 1,
    });
    expect(sniffSampleHeader(encodeWav([tone, tone], 96_000, 24))).toMatchObject({
      sampleRate: 96_000,
      channels: 2,
    });
    const flacTone = sine(440, 48_000, 0.05);
    expect(sniffSampleHeader(encodeFlac([flacTone], 48_000))).toEqual({
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

  it('refuses a pack id with a slash', () => {
    expect(
      () => new SfzPack({ id: 'a/b', files: { read: () => Promise.resolve(new Uint8Array()) } }),
    ).toThrow(RangeError);
  });
});

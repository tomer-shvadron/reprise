import { NativeFormatError, ScoreSchema, parseNative } from '@reprise/model';
import { fullScore } from '@reprise/model/testing';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  FORMATS,
  FormatError,
  GpError,
  GpxError,
  MAX_FILE_BYTES,
  detect,
  formatOfExtension,
  read,
  readGp,
  readGp3To5,
  readGpx,
  write,
} from '../src/index';
import type { Format, Warning } from '../src/index';
import {
  allManifestEntries,
  countNotes,
  featuresOf,
  fixtureBytes,
  manifestEntries,
} from './corpus';
import { bcfz, gpx } from './gpx-builder';
import { kitchenSink } from './kitchen-sink';

const FAMILIES = ['gp3', 'gp4', 'gp5', 'gp', 'gpx'] as const;
const entries = manifestEntries(FAMILIES);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

async function failure(promise: Promise<unknown>): Promise<FormatError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FormatError) return error;
    throw error;
  }
  throw new Error('expected a FormatError, but it resolved');
}

function directCodes(path: string, bytes: Uint8Array): string[] {
  if (path.endsWith('.gp')) return readGp(bytes).warnings.map((w) => w.code);
  if (path.endsWith('.gpx')) return readGpx(bytes).warnings.map((w) => w.code);
  return readGp3To5(bytes).warnings.map((w) => w.code);
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectWellFormed(warnings: Warning[]): void {
  for (const warning of warnings) {
    expect(warning.code).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(warning.message).not.toBe('');
    expect(['info', 'warning', 'error']).toContain(warning.severity);
    expect(typeof warning.location).toBe('object');
    if (warning.count !== undefined) expect(warning.count).toBeGreaterThanOrEqual(1);
  }
}

describe('the import service on the fixture corpus', () => {
  const manifest = allManifestEntries();

  it('tests every fixture in the manifest', () => {
    expect(entries).toHaveLength(manifest.length);
  });

  it.each(manifest)('reads $path as a format it supports ($format)', ({ format }) => {
    expect(FAMILIES).toContain(format);
    expect(FORMATS).toContain(format);
  });

  describe.each(entries)('$path', (entry) => {
    const bytes = fixtureBytes(entry.path);

    it('detects its format from the bytes alone', () => {
      expect(detect(bytes)).toBe(entry.format);
    });

    it('reads with the manifest counts and features', async () => {
      const { score, warnings } = await read(bytes);
      expect(score.tracks).toHaveLength(entry.tracks);
      expect(score.masterBars).toHaveLength(entry.bars);
      expect(countNotes(score)).toBe(entry.notes);
      expect([...featuresOf(score)].sort()).toEqual([...entry.features].sort());
      expect(warnings.filter((w) => w.severity === 'error')).toEqual([]);
      expectWellFormed(warnings);
      expect(warnings.map((w) => w.code)).toEqual(directCodes(entry.path, bytes));
    });
  });

  it('detects a renamed file by its content', async () => {
    const bytes = fixtureBytes('gp/timer.gp');
    expect(formatOfExtension('timer.gp5')).toBe('gp5');
    expect(detect(bytes)).toBe('gp');
    const { score } = await read(bytes);
    expect(score.tracks.length).toBeGreaterThan(0);
  });
});

describe('a format argument the bytes contradict', () => {
  const gp = fixtureBytes('gp/timer.gp');
  const gp5 = fixtureBytes('gp5/chords.gp5');

  it.each<[string, Uint8Array, Format, Format]>([
    ['gp as gp5', gp, 'gp5', 'gp'],
    ['gp5 as gpx', gp5, 'gpx', 'gp5'],
    ['gp5 as gp', gp5, 'gp', 'gp5'],
    ['gp5 as reprise', gp5, 'reprise', 'gp5'],
  ])('reports %s as a mismatch', async (_, bytes, format, detected) => {
    const error = await failure(read(bytes, format));
    expect(error).toMatchObject({ code: 'format-mismatch', format, detected });
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('reads a gp4 file named gp5, since one reader serves the binary family', async () => {
    const { score } = await read(fixtureBytes('gp4/notes.gp4'), 'gp5');
    expect(score.tracks.length).toBeGreaterThan(0);
  });

  it('keeps the reader code when nothing else is detected', async () => {
    const error = await failure(read(new Uint8Array(3), 'gp'));
    expect(error).toMatchObject({ code: 'invalid-zip', format: 'gp' });
    expect(error.detected).toBeUndefined();
  });
});

describe('damaged files', () => {
  it('reads a cut-short binary file with a truncated-file error warning', async () => {
    const bytes = fixtureBytes('gp5/effects.gp5');
    for (const length of [60, Math.floor(bytes.length * 0.75)]) {
      const { warnings } = await read(bytes.slice(0, length));
      expect(warnings).toContainEqual(
        expect.objectContaining({ code: 'truncated-file', severity: 'error' }),
      );
    }
  });

  it('rejects a cut-short gpx file as truncated', async () => {
    const bytes = fixtureBytes('gpx/effects.gpx');
    for (const length of [9, 100, 4000]) {
      const error = await failure(read(bytes.slice(0, length)));
      expect(error).toMatchObject({ code: 'truncated', format: 'gpx' });
      expect(error.cause).toBeInstanceOf(GpxError);
    }
  });

  it('rejects a cut-short gp file as an invalid zip', async () => {
    const bytes = fixtureBytes('gp/timer.gp');
    const error = await failure(read(bytes.slice(0, bytes.length / 2)));
    expect(error).toMatchObject({ code: 'invalid-zip', format: 'gp' });
  });

  it('rejects containers without a score', async () => {
    await expect(read(gpx({ misc: '<x/>' }))).rejects.toMatchObject({ code: 'missing-score' });
    const zip = zipSync({ 'Content/other.xml': encode('<x/>') });
    await expect(read(zip)).rejects.toMatchObject({ code: 'missing-score', format: 'gp' });
  });

  it('keeps the gpif position on an XML error', async () => {
    const zip = zipSync({ 'Content/score.gpif': encode('<GPIF>\n<Score>\n</GPIF>') });
    const error = await failure(read(zip));
    expect(error.code).toBe('invalid-xml');
    expect(error.cause).toMatchObject({ line: 3 });
  });

  it('rejects empty and unrecognised bytes as an unknown format', async () => {
    for (const bytes of [new Uint8Array(0), encode('hello')]) {
      const error = await failure(read(bytes));
      expect(error).toMatchObject({ code: 'unknown-format' });
      expect(error.format).toBeUndefined();
    }
  });

  it('yields a valid score or a FormatError for flipped bytes, nothing else', async () => {
    const next = random(45);
    for (const entry of entries) {
      const original = fixtureBytes(entry.path);
      for (let run = 0; run < 40; run++) {
        const bytes = original.slice();
        const flips = 1 + Math.floor(next() * 4);
        for (let flip = 0; flip < flips; flip++) {
          const at = 32 + Math.floor(next() * (bytes.length - 32));
          bytes[at] = Math.floor(next() * 256);
        }
        try {
          const { score } = await read(bytes);
          expect(ScoreSchema.safeParse(score).success).toBe(true);
        } catch (error) {
          if (!(error instanceof FormatError)) throw error;
        }
      }
    }
  });
});

describe('the size limit', () => {
  it('refuses a file over the limit before reading it', async () => {
    const error = await failure(read(new Uint8Array(MAX_FILE_BYTES + 1)));
    expect(error.code).toBe('too-large');
    expect(error.cause).toBeUndefined();
  });

  it('passes through a zip entry declaring more than the limit', async () => {
    const zip = zipSync({ 'Content/score.gpif': encode('<GPIF/>') });
    const name = encode('Content/score.gpif');
    for (let at = 0; at + 46 + name.length <= zip.length; at++) {
      const signature = zip[at] === 0x50 && zip[at + 1] === 0x4b && zip[at + 2] === 0x01;
      if (!signature || zip[at + 3] !== 0x02) continue;
      if (!name.every((byte, index) => zip[at + 46 + index] === byte)) continue;
      new DataView(zip.buffer, zip.byteOffset).setUint32(at + 24, 0xff_ff_ff_fe, true);
    }
    const error = await failure(read(zip));
    expect(error).toMatchObject({ code: 'too-large', format: 'gp' });
    expect(error.cause).toBeInstanceOf(GpError);
  });

  it('passes through a BCFZ header declaring more than the limit', async () => {
    const error = await failure(read(bcfz(MAX_FILE_BYTES + 1, [])));
    expect(error).toMatchObject({ code: 'too-large', format: 'gpx' });
    expect(error.cause).toBeInstanceOf(GpxError);
  });
});

describe('the native format', () => {
  it('round-trips a score through write and read', async () => {
    const { score } = await read(fixtureBytes('gp5/chords.gp5'));
    const { bytes, dropped } = await write(score, 'reprise');
    expect(dropped).toEqual([]);
    expect(detect(bytes)).toBe('reprise');
    expect(decode(bytes)).toContain('"name": "reprise"');
    const back = await read(bytes);
    expect(back.score).toEqual(score);
    expect(back.warnings).toHaveLength(parseNative(bytes).warnings.length);
  });

  it('stamps the given app', async () => {
    const { score } = await read(fixtureBytes('gp3/notes.gp3'));
    const { bytes } = await write(score, 'reprise', { app: { name: 'tester', version: '1.2.3' } });
    expect(parseNative(bytes).app).toEqual({ name: 'tester', version: '1.2.3' });
  });

  it('rejects JSON that is not a reprise document', async () => {
    await expect(read(encode('{}'))).rejects.toMatchObject({
      code: 'wrong-format',
      format: 'reprise',
    });
    await expect(read(encode('[]'), 'reprise')).rejects.toMatchObject({
      code: 'invalid-document',
    });
  });

  it('reports an unknown score field at its path, and reads past a BOM', async () => {
    const { score } = await read(fixtureBytes('gp3/notes.gp3'));
    const { bytes } = await write(score, 'reprise');
    const text = decode(bytes).replace('"score": {', '"score": {\n    "extra": 1,');
    expect(text).toContain('"extra": 1');
    const { warnings } = await read(encode(`\u{feff}${text}`));
    expect(warnings.filter((w) => w.code === 'unknown-field')).toEqual([
      expect.objectContaining({
        code: 'unknown-field',
        severity: 'warning',
        location: { path: ['extra'] },
      }),
    ]);
  });

  it('reports a top-level unknown field outside the score path', async () => {
    const { score } = await read(fixtureBytes('gp3/notes.gp3'));
    const { bytes } = await write(score, 'reprise');
    const text = decode(bytes).replace('{', '{\n  "extra": 1,');
    const { warnings } = await read(encode(text));
    expect(warnings.filter((w) => w.code === 'unknown-field')).toEqual([
      expect.objectContaining({ location: { element: 'extra' } }),
    ]);
  });

  it('rejects a document from a newer Reprise as newer-version', async () => {
    const { score } = await read(fixtureBytes('gp3/notes.gp3'));
    const { bytes } = await write(score, 'reprise');
    const newer = encode(decode(bytes).replace(/"version": 1\b/, '"version": 2'));
    for (const format of [undefined, 'reprise'] as const) {
      const error = await failure(read(newer, format));
      expect(error).toMatchObject({ code: 'newer-version', format: 'reprise' });
      expect(error.cause).toBeInstanceOf(NativeFormatError);
    }
  });

  it('rejects a truncated document as invalid JSON', async () => {
    const { score } = await read(fixtureBytes('gp3/notes.gp3'));
    const { bytes } = await write(score, 'reprise');
    const error = await failure(read(bytes.slice(0, bytes.length / 2)));
    expect(error).toMatchObject({ code: 'invalid-json', format: 'reprise' });
    expect(error.cause).toBeInstanceOf(NativeFormatError);
  });

  it('rejects an invalid score as a FormatError', async () => {
    const { score } = await read(fixtureBytes('gp3/notes.gp3'));
    const error = await failure(write({ ...score, masterBars: [] }, 'reprise'));
    expect(error).toMatchObject({ code: 'invalid-document', format: 'reprise' });
  });
});

describe('gp export', () => {
  it('writes a gp file that reads back with the same counts', async () => {
    const source = kitchenSink();
    const { bytes, dropped } = await write(source, 'gp');
    expect(detect(bytes)).toBe('gp');
    const { score } = await read(bytes);
    expect(score.tracks).toHaveLength(source.tracks.length);
    expect(score.masterBars).toHaveLength(source.masterBars.length);
    expect(countNotes(score)).toBe(countNotes(source));
    for (const warning of dropped) {
      expect(warning.severity).toBe('warning');
      expect(Array.isArray(warning.location.path)).toBe(true);
      if (warning.count !== undefined) expect(warning.count).toBeGreaterThan(1);
    }
  });

  it('keeps a gp fixture through read, write and read', async () => {
    const entry = entries.find((e) => e.path === 'gp/timer.gp');
    if (!entry) throw new Error('gp/timer.gp is not in the manifest');
    const { score } = await read(fixtureBytes(entry.path));
    const { bytes } = await write(score, 'gp');
    const back = await read(bytes);
    expect(back.score.tracks).toHaveLength(entry.tracks);
    expect(back.score.masterBars).toHaveLength(entry.bars);
    expect(countNotes(back.score)).toBe(entry.notes);
  });

  it("reports the writer's losses on fullScore as warnings at their score paths", async () => {
    const { dropped } = await write(fullScore(), 'gp');
    expect(dropped.map((w) => [w.code, w.location.path])).toEqual([
      ['section-color', ['masterBars', 0, 'section', 'color']],
      ['channel-effect', ['tracks', 0, 'channel']],
      ['sound-override', ['tracks', 0, 'sound']],
      ['chord-barre', ['tracks', 0]],
      ['mixer-change', ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 0, 'mix']],
      ['stroke', ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 0, 'effects', 'arpeggio']],
      ['note-dynamics', ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 0]],
      [
        'trill-speed',
        ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 0, 'notes', 0, 'trill', 'speed'],
      ],
    ]);
    expect(new Set(dropped.map((w) => w.severity))).toEqual(new Set(['warning']));
  });
});

describe('read timing', () => {
  it('adds nothing measurable to the largest fixture', async () => {
    const bytes = fixtureBytes('gpx/effects.gpx');
    await read(bytes);
    const runs = 20;
    const start = Date.now();
    for (let run = 0; run < runs; run++) await read(bytes);
    const perRead = (Date.now() - start) / runs;
    expect(perRead).toBeLessThan(100);
  });
});

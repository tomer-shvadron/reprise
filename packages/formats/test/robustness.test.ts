import { ScoreSchema } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { GpVersionError, readGp3To5 } from '../src/index';
import type { GpReadResult } from '../src/index';
import { fixtureBytes, manifestEntries } from './corpus';

const entries = manifestEntries(['gp3', 'gp4', 'gp5']);

/** mulberry32: a fixed seed keeps the fuzz cases the same on every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Either a schema-valid score or the one error the reader may throw: an unrecognised header. */
function readSafely(bytes: Uint8Array): GpReadResult | GpVersionError {
  try {
    const result = readGp3To5(bytes);
    const parsed = ScoreSchema.safeParse(result.score);
    if (!parsed.success) throw new Error(`schema-invalid score: ${parsed.error.message}`);
    return result;
  } catch (error) {
    if (error instanceof GpVersionError) return error;
    throw error;
  }
}

describe('unknown versions', () => {
  it('fail with the version string', () => {
    const bytes = fixtureBytes('gp5/chords.gp5');
    bytes.set(
      Array.from('v5.20', (char) => char.charCodeAt(0)),
      20,
    );
    expect(() => readGp3To5(bytes)).toThrow(
      'unsupported Guitar Pro version "FICHIER GUITAR PRO v5.20"',
    );
    try {
      readGp3To5(bytes);
    } catch (error) {
      expect(error).toBeInstanceOf(GpVersionError);
      expect(error).toMatchObject({ code: 'unknown-version', version: 'FICHIER GUITAR PRO v5.20' });
    }
  });

  it('fail on something that is not a Guitar Pro file at all', () => {
    expect(() => readGp3To5(new TextEncoder().encode('PK\u0003\u0004 not a tab'))).toThrow(
      GpVersionError,
    );
    expect(() => readGp3To5(new Uint8Array())).toThrow('no version header');
  });
});

describe('truncated files', () => {
  it.each(entries.map((entry) => entry.path))('%s yields a partial score at every cut', (path) => {
    const bytes = fixtureBytes(path);
    for (let length = 31; length < bytes.length - 4; length += 17) {
      const result = readSafely(bytes.subarray(0, length));
      expect(result).not.toBeInstanceOf(GpVersionError);
      if (result instanceof GpVersionError) continue;
      expect(result.warnings.some((warning) => warning.code === 'truncated-file')).toBe(true);
    }
  });

  it('yields a partial score at every byte of a GP5 header', () => {
    const bytes = fixtureBytes('gp5/chords.gp5');
    for (let length = 31; length < 1460; length++) {
      const result = readSafely(bytes.subarray(0, length));
      expect(result).not.toBeInstanceOf(GpVersionError);
    }
  });

  it('keeps the bars read before the cut', () => {
    const bytes = fixtureBytes('gp5/effects.gp5');
    const full = readGp3To5(bytes).score;
    const { score, warnings } = readGp3To5(bytes.subarray(0, Math.floor(bytes.length * 0.75)));
    const cut = warnings.find((warning) => warning.code === 'truncated-file');
    expect(cut?.severity).toBe('error');
    expect(cut?.location.offset).toBeGreaterThan(0);
    expect(score.masterBars).toHaveLength(full.masterBars.length);
    const beats = (s: typeof score) =>
      s.tracks[0]?.bars.flatMap((bar) => bar.voices[0].beats) ?? [];
    expect(beats(score).length).toBeGreaterThan(0);
    expect(beats(score).length).toBeLessThan(beats(full).length);
    expect(beats(score).map((beat) => beat.duration)).toEqual(
      beats(full)
        .slice(0, beats(score).length)
        .map((beat) => beat.duration),
    );
  });

  it('keeps the metadata of a file cut inside its header', () => {
    const { score, warnings } = readGp3To5(fixtureBytes('gp3/effects.gp3').subarray(0, 60));
    expect(score.meta.title).toBe('Effects');
    expect(score.masterBars).toHaveLength(1);
    expect(score.tracks).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'truncated-file', severity: 'error' });
  });
});

describe('corrupt counts', () => {
  it('stops at a notice count no real file holds instead of reading to the end', () => {
    const bytes = new Uint8Array(1 << 20);
    bytes.set(fixtureBytes('gp5/chords.gp5').subarray(0, 31));
    // Nine empty header strings (int 1, byte 0), then the notice count.
    let offset = 31;
    for (let i = 0; i < 9; i++) {
      bytes[offset] = 1;
      offset += 5;
    }
    new DataView(bytes.buffer).setInt32(offset, 0x7fffffff, true);
    const { score, warnings } = readGp3To5(bytes);
    expect(score.meta.notices).toEqual([]);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'corrupt-file', severity: 'error', location: { offset } }),
    ]);
  });
});

describe('bit-flipped files', () => {
  it.each(entries.map((entry) => entry.path))('%s never throws past the reader', (path) => {
    const original = fixtureBytes(path);
    const next = random(original.length);
    for (let run = 0; run < 150; run++) {
      const bytes = original.slice();
      const flips = 1 + Math.floor(next() * 8);
      for (let flip = 0; flip < flips; flip++) {
        // Leave the version header alone so most runs get past it into the structures.
        const at = 31 + Math.floor(next() * (bytes.length - 31));
        bytes[at] = (bytes[at] ?? 0) ^ (1 << Math.floor(next() * 8));
      }
      expect(() => readSafely(bytes)).not.toThrow();
    }
  });

  it('survives random bytes after a valid header', () => {
    const next = random(7);
    const header = fixtureBytes('gp5/chords.gp5').subarray(0, 31);
    for (let run = 0; run < 200; run++) {
      const bytes = new Uint8Array(31 + Math.floor(next() * 4000));
      bytes.set(header);
      for (let i = 31; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
      expect(() => readSafely(bytes)).not.toThrow();
    }
  });
});

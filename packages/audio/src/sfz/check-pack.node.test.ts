import { describe, expect, it } from 'vitest';

import common from '../../test-fixtures/sfz/common.sfzh?raw';
import synthetic from '../../test-fixtures/sfz/synthetic.sfz?raw';
import { checkPack, formatPackReport } from './check-pack';
import type { PackSnapshot } from './check-pack';
import { loadSfz } from './load';
import { memoryReader } from './test-reader';
import { encodeFlac, encodeWav, sine } from './test/encode';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The synthetic fixture with a generated file behind every sample it names. */
async function snapshot(): Promise<PackSnapshot> {
  const reader = memoryReader({ 'synthetic.sfz': synthetic, 'common.sfzh': common });
  const { regions } = await loadSfz('synthetic.sfz', reader, { packId: 'check' });
  const files: Record<string, { size: number; bytes: Uint8Array }> = {
    'synthetic.sfz': { size: synthetic.length, bytes: enc(synthetic) },
    'common.sfzh': { size: common.length, bytes: enc(common) },
  };
  for (const ref of new Set(regions.map((r) => r.sample.slice('sfz:check/'.length)))) {
    const bytes = encodeWav([sine(440, 22_050, 0.01)], 22_050);
    files[ref] = { size: bytes.length, bytes };
  }
  return files;
}

describe('checkPack', () => {
  it('passes a pack whose every sample exists with a decodable header', async () => {
    const [result, ...rest] = await checkPack(await snapshot());
    expect(rest).toEqual([]);
    expect(result).toMatchObject({
      path: 'synthetic.sfz',
      missing: [],
      badHeaders: [],
      errors: [],
      rates: [22_050],
    });
    expect(result?.samples).toBeGreaterThan(20);
    expect(result?.formats).toEqual({ wav: result?.samples });
    expect(formatPackReport(result ? [result] : [])).toMatch(/^ok +synthetic\.sfz/);
  });

  it('fails on a missing file, naming a case-only difference, and on a bad header', async () => {
    const files: Record<string, { size: number; bytes: Uint8Array }> = { ...(await snapshot()) };
    delete files['samples/kick.wav'];
    files['samples/KICK.WAV'] = files['samples/ride.wav'] ?? { size: 0, bytes: new Uint8Array() };
    delete files['samples/pad.wav'];
    files['samples/hat open.wav'] = { size: 9, bytes: enc('not audio') };
    const [result] = await checkPack(files);
    expect(result?.missing).toEqual([
      'samples/pad.wav',
      'samples/kick.wav (case differs: samples/KICK.WAV)',
    ]);
    expect(result?.badHeaders.map((bad) => bad.path)).toEqual(['samples/hat open.wav']);
    expect(result?.errors).toHaveLength(2);
    expect(formatPackReport(result ? [result] : [])).toMatch(/^FAIL synthetic\.sfz/);
  });

  it('counts FLAC and fails a file that loses data or cannot be read', async () => {
    const flac = encodeFlac([sine(440, 48_000, 0.01)], 48_000);
    const results = await checkPack({
      'a.sfz': { size: 0, bytes: enc('<region> sample=a.flac key=lokey') },
      'a.flac': { size: flac.length, bytes: flac },
      'b.sfz': { size: 0, bytes: enc('#include "nope.sfzh"\n<region> sample=a.flac key=60') },
      'c.sfz': { size: 0, bytes: enc('<region> sample=../x.wav key=60') },
    });
    expect(results.map((r) => [r.path, r.errors.length > 0])).toEqual([
      ['a.sfz', true],
      ['b.sfz', true],
      ['c.sfz', true],
    ]);
    expect(results[0]?.report.invalid).toEqual({ key: 1 });
    expect(results[1]?.formats).toEqual({ flac: 1 });
    expect(results[1]?.report.unresolvedIncludes).toEqual(['nope.sfzh']);
    expect(results[2]?.report.escapedPaths).toHaveLength(1);
  });
});

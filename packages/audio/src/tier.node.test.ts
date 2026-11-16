import { createTrack } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { checkPack, checkSfzFile, tierOf } from './index';
import type { PackSnapshot } from './index';
import { encodeFlac, encodeWav, syntheticSfzPack } from './testing/index';
import { sine } from './sfz/test/encode';

describe('tierOf', () => {
  const track = { ...createTrack('fretted'), id: 'track0000001' };

  it('is gm with no assignment and hq once one names the track', () => {
    expect(tierOf(track, [])).toBe('gm');
    expect(tierOf(track, [{ trackId: 'other0000001' }])).toBe('gm');
    expect(tierOf(track, [{ trackId: 'other0000001' }, { trackId: track.id }])).toBe('hq');
  });

  it('stays gm for a track that only names a pack in its sound', () => {
    expect(tierOf({ ...track, sound: { packId: 'abcdefghijkl' } }, [])).toBe('gm');
  });
});

describe('the testing pack helpers', () => {
  const snapshotOf = (contents: ReadonlyMap<string, Uint8Array>): PackSnapshot =>
    Object.fromEntries([...contents].map(([path, bytes]) => [path, { size: bytes.length, bytes }]));

  it('builds a pack that passes the pack check from the root export', async () => {
    const pack = syntheticSfzPack();
    const results = await checkPack(snapshotOf(pack.contents));
    expect(results.map((entry) => entry.path)).toEqual(['alt.sfz', 'default.sfz']);
    expect(results.every((entry) => entry.errors.length === 0)).toBe(true);
    expect((await checkSfzFile(snapshotOf(pack.contents), 'default.sfz')).regions).toBe(1);
  });

  it('encodes WAV and FLAC the check reads', async () => {
    const tone = sine(440, 44_100, 0.05);
    const snapshot: PackSnapshot = {
      'a.sfz': {
        size: 1,
        bytes: new TextEncoder().encode('<region> sample=a.wav\n<region> sample=b.flac\n'),
      },
      'a.wav': { size: 1, bytes: encodeWav([tone], 44_100) },
      'b.flac': { size: 1, bytes: encodeFlac([tone], 44_100) },
    };
    const result = await checkSfzFile(snapshot, 'a.sfz');
    expect(result.errors).toEqual([]);
    expect(result.formats).toEqual({ wav: 1, flac: 1 });
  });
});

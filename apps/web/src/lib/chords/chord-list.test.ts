import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { chordList } from './chord-list';

const own = { baseFret: 1, frets: [0, 1, 2, 2, 0, null] };

function track(kind: 'guitar' | 'drums' = 'guitar') {
  const built = score().track(kind);
  const at = (name: string, diagram?: typeof own) => ({
    chord: { name, ...(diagram && { diagram }) },
  });
  const string = kind === 'guitar' ? 1 : 0;
  built
    .bar()
    .beat('4', [note(string, 0)], at('Am'))
    .beat('4', [note(string, 0)], at('G', own))
    .beat('4', [note(string, 0)], at('Am'))
    .beat('4', [note(string, 0)], at('Zzz'));
  built
    .bar()
    .beat('4', [note(string, 0)], at('G', own))
    .beat('4', [note(string, 0)], at('G'))
    .rest('2');
  return built.build({ ids: 'sequential' }).tracks[0];
}

describe('chordList', () => {
  it('is empty without a track', () => {
    expect(chordList(undefined)).toEqual([]);
  });

  it('lists distinct chords in first-use order with the beats that use each', () => {
    const entries = chordList(track());
    expect(entries.map((e) => e.name)).toEqual(['Am', 'G', 'Zzz', 'G']);
    expect(entries[0]?.beats).toHaveLength(2);
    expect(entries[1]?.beats).toHaveLength(2);
    // The same name with and without a diagram is two entries.
    expect(entries[1]?.key).not.toBe(entries[3]?.key);
  });

  it('suggests the first shape for a name with no diagram, and keeps the file diagram as is', () => {
    const [am, g, zzz, bare] = chordList(track());
    expect(am).toMatchObject({ suggested: true, diagram: { frets: [0, 1, 2, 2, 0, null] } });
    expect(g).toMatchObject({ suggested: false, diagram: own });
    expect(zzz?.diagram).toBeUndefined();
    expect(zzz?.suggested).toBe(false);
    expect(bare?.suggested).toBe(true);
  });

  it('suggests nothing on a track without frets', () => {
    const entries = chordList(track('drums'));
    expect(entries.every((e) => !e.suggested)).toBe(true);
  });
});

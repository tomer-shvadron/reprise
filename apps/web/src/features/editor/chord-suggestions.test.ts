import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { chordNamesIn, suggestChords } from './chord-suggestions';

function song() {
  const built = score().track('guitar');
  built
    .bar()
    .beat('4', [note(1, 0)], { chord: { name: 'G' } })
    .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
    .beat('4', [note(1, 0)], { chord: { name: 'G' } })
    .beat('4', [note(1, 0)], { chord: { name: 'Em' } });
  built.bar().beat('4', [note(1, 0)], { chord: { name: 'Am' } });
  built.bar().beat('4', [note(1, 0)], { chord: { name: 'G' } });
  return built.build({ ids: 'sequential' });
}

describe('chordNamesIn', () => {
  it('lists the song names, most frequent first, once each', () => {
    expect(chordNamesIn(song())).toEqual(['G', 'Am', 'Em']);
  });

  it('is computed once per score', () => {
    const built = song();
    expect(chordNamesIn(built)).toBe(chordNamesIn(built));
  });
});

describe('suggestChords', () => {
  it('filters by prefix, ignores case and leaves out the exact match', () => {
    const built = song();
    expect(suggestChords(built, '')).toEqual(['G', 'Am', 'Em']);
    expect(suggestChords(built, 'a')).toEqual(['Am']);
    expect(suggestChords(built, 'am')).toEqual([]);
    expect(suggestChords(built, 'x')).toEqual([]);
  });
});

import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  chordNamesFromNotes,
  chordNamesIn,
  suggestChords,
  suggestChordsFor,
} from './chord-suggestions';

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

describe('chord names from the notes', () => {
  function notes() {
    const built = score().track('guitar');
    // x32010: C. Standard tuning, string 1 is the highest.
    built
      .bar()
      .beat('4', [note(5, 3), note(4, 2), note(2, 1)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(5, 3), note(4, 2), note(3, 0), note(2, 1), note(1, 0)]);
    return built.build({ ids: 'sequential' });
  }
  const beatId = (built: ReturnType<typeof notes>, index: number) =>
    built.tracks[0]?.bars[0]?.voices[0]?.beats[index]?.id ?? '';

  it('names the beat from its notes', () => {
    const built = notes();
    expect(chordNamesFromNotes(built, beatId(built, 2))[0]).toBe('C');
    expect(chordNamesFromNotes(built, beatId(built, 1))).toEqual([]);
  });

  it('puts the notes first, then the song, filtered by what was typed', () => {
    const built = song();
    const withNotes = notes();
    const id = beatId(withNotes, 2);
    expect(suggestChordsFor(withNotes, '', id)).toEqual({ names: ['C'], fromNotes: 1 });
    expect(suggestChordsFor(withNotes, 'c', id).names).toEqual([]);
    expect(suggestChordsFor(withNotes, 'g', id).names).toEqual([]);
    expect(suggestChordsFor(built, 'a').fromNotes).toBe(0);
  });
});

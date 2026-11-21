import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { chordNamesFromNotes, chordNamesIn, suggestChordsFor } from './chord-suggestions';

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

describe('suggestChordsFor without a beat', () => {
  it('filters by prefix, ignores case and leaves out the exact match', () => {
    const built = song();
    expect(suggestChordsFor(built, '').names).toEqual(['G', 'Am', 'Em']);
    expect(suggestChordsFor(built, 'a').names).toEqual(['Am']);
    expect(suggestChordsFor(built, 'am').names).toEqual([]);
    expect(suggestChordsFor(built, 'x').names).toEqual([]);
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

describe('naming in context', () => {
  const C = [note(5, 3), note(4, 2), note(3, 0), note(2, 1), note(1, 0)];
  const first = (built: ReturnType<ReturnType<typeof score>['build']>) =>
    built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id ?? '';

  it('names by sounding pitch: the C shape with a capo on 2 is D', () => {
    const built = score().track('guitar', { capo: 2 });
    built.bar().beat('4', C);
    const done = built.build({ ids: 'sequential' });
    expect(chordNamesFromNotes(done, first(done))[0]).toBe('D');
  });

  it('skips a dead note, so it makes no slash bass', () => {
    const built = score().track('guitar');
    built.bar().beat('4', [note(6, 0, { dead: true }), ...C]);
    const done = built.build({ ids: 'sequential' });
    expect(chordNamesFromNotes(done, first(done))[0]).toBe('C');
  });

  it('spells for the key of the bar', () => {
    const flat = score().key(-1);
    const built = flat.track('guitar');
    built.bar().beat('4', [note(5, 1), note(4, 3), note(3, 3), note(2, 3), note(1, 1)]);
    const done = built.build({ ids: 'sequential' });
    expect(chordNamesFromNotes(done, first(done))[0]).toBe('Bb');
  });

  it('names a pitched track by its MIDI notes and gives nothing for drums', () => {
    const keys = score().track('piano');
    keys.bar().beat('4', [note(0, 60), note(0, 64), note(0, 67)]);
    const piano = keys.build({ ids: 'sequential' });
    expect(chordNamesFromNotes(piano, first(piano))[0]).toBe('C');
    const kit = score().track('drums');
    kit.bar().beat('4', [note(0, 36), note(0, 38), note(0, 42)]);
    const drums = kit.build({ ids: 'sequential' });
    expect(chordNamesFromNotes(drums, first(drums))).toEqual([]);
  });

  it('names a harmonic by the pitch it sounds', () => {
    // The fifth-fret harmonic on the low E sounds E (fretted it would be A), with open G and B: Em.
    const built = score().track('guitar');
    const harmonic = { harmonic: { kind: 'natural' as const } };
    built.bar().beat('4', [note(6, 5, harmonic), note(3, 0), note(2, 0)]);
    const done = built.build({ ids: 'sequential', validate: false });
    // The harmonic sounds above the open G, so G is the bass; fretted it would be an A and never Em.
    expect(chordNamesFromNotes(done, first(done))).toContain('Em');
  });

  it('skips a note on a string the tuning lacks instead of throwing', () => {
    const built = score().track('guitar');
    built.bar().beat('4', [...C, note(0, 3), note(9, 3)]);
    const done = built.build({ ids: 'sequential', validate: false });
    expect(chordNamesFromNotes(done, first(done))[0]).toBe('C');
  });

  it('lists a song name that the notes also spell once, among the notes names', () => {
    const built = score().track('guitar');
    built
      .bar()
      .beat('4', C)
      .beat('4', [note(1, 0)], { chord: { name: 'C' } });
    built.bar().beat('4', [note(1, 0)], { chord: { name: 'Am' } });
    const done = built.build({ ids: 'sequential' });
    const { names, fromNotes } = suggestChordsFor(done, '', first(done));
    expect(names.filter((name) => name === 'C')).toHaveLength(1);
    expect(names.indexOf('C')).toBeLessThan(fromNotes);
    expect(names).toContain('Am');
  });
});

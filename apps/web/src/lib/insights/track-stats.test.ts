import { midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { noteTableOf } from './note-table';
import { songOutline } from './outline';
import { pitchName, trackStats } from './track-stats';

const NEUTRAL = { fifths: 0, minor: false };
const FLATS = { fifths: -2, minor: false };

function statsOf(built: ReturnType<ReturnType<typeof score>['build']>, key = NEUTRAL) {
  return trackStats(noteTableOf(built), songOutline(built), key, []);
}

describe('pitchName', () => {
  it('spells for the key with the octave of middle C as 4', () => {
    expect(pitchName(60, NEUTRAL)).toBe('C4');
    expect(pitchName(40, NEUTRAL)).toBe('E2');
    expect(pitchName(70, FLATS)).toBe('B♭4');
    expect(pitchName(70, { fifths: 2, minor: false })).toBe('A♯4');
  });
});

describe('trackStats', () => {
  const built = score()
    .track('guitar', { name: 'Lead' })
    .bar()
    .beat('4', [note(6, 0)])
    .beat('4', [
      note(2, 5, {
        bend: {
          kind: 'bend',
          points: [
            { position: 0, value: 0 },
            { position: 60, value: 4 },
          ],
        },
      }),
    ])
    .beat('4', [note(2, 7, { palmMute: true }), note(3, 7)])
    .beat('4', [note(1, 8, { palmMute: true, vibrato: 'wide' })])
    .bar()
    .beat('4', [note(1, 8, { tie: true })])
    .beat('4', [note(1, 8, { dead: true })])
    .beat('4', [note(1, 8)], { effects: { tapping: true } })
    .beat('4', [note(1, 7)])
    .track('piano', { name: 'Keys' })
    .bar()
    .beat('1', [midi(48)])
    .bar()
    .beat('1', [midi(72)])
    .track('drums', { name: 'Drums' })
    .bar()
    .beat('4', [midi(36)])
    .beat('4', [midi(38)])
    .build();
  const [lead, keys, drums] = statsOf(built);

  it('gives the range of sounding pitches spelled with octaves', () => {
    expect(lead?.range).toMatchObject({ lowName: 'E2', highName: 'C5' });
    expect(keys?.range).toMatchObject({ low: 48, high: 72, lowName: 'C3', highName: 'C5' });
  });

  it('counts struck notes, not ties or dead notes', () => {
    expect(lead?.notes).toBe(7);
    expect(keys?.notes).toBe(2);
  });

  it('gives the fret range and the busiest four-fret position of a fretted track', () => {
    expect(lead?.frets).toMatchObject({ lowest: 5, highest: 8 });
    expect(lead?.frets?.position).toEqual({ from: 5, to: 8 });
    expect(keys?.frets).toBeUndefined();
  });

  it('counts each technique and lists the most used first', () => {
    expect(lead?.techniques[0]).toEqual({ name: 'palmMute', count: 2 });
    const names = lead?.techniques.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['bend', 'bendWide', 'vibrato', 'tapping']));
    expect(lead?.techniques.length).toBeLessThanOrEqual(6);
  });

  it('shows a drum track by its notes and its most used instruments', () => {
    expect(drums?.kind).toBe('drums');
    expect(drums?.notes).toBe(2);
    expect(drums?.drums?.top.map((d) => d.name)).toEqual(['Bass Drum 1', 'Acoustic Snare']);
    expect(drums?.range).toBeUndefined();
  });

  it('survives a structured clone', () => {
    const all = statsOf(built);
    expect(structuredClone(all)).toEqual(all);
  });

  it('copes with a track without notes', () => {
    const empty = statsOf(score().track('guitar').bar().rest('1').build());
    expect(empty[0]).toMatchObject({ notes: 0, techniques: [] });
    expect(empty[0]?.range).toBeUndefined();
  });
});

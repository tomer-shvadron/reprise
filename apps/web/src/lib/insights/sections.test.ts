import { midi, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { noteTableOf } from './note-table';
import { songOutline } from './outline';
import { sectionInsights, sectionSpans, trackScales } from './sections';
import { chord, repeat, run, song, type SongBar } from './test/songs';

const A = 9;
/** A minor pentatonic over A, as eight eighths. */
const PENTATONIC = [57, 60, 62, 64, 67, 69, 72, 76];

const aMinor = (section?: string): SongBar[] =>
  [chord(A, true), chord(5), chord(0), chord(7)].map((voicing, index) => ({
    chord: voicing,
    melody: PENTATONIC,
    ...(index === 0 && section ? { section } : {}),
  }));

describe('sectionSpans', () => {
  it('runs each section to the bar before the next and names leading bars', () => {
    const built = score()
      .track('piano')
      .bar()
      .beat('1', [midi(60)])
      .bar()
      .section('Verse')
      .beat('1', [midi(60)])
      .bar()
      .beat('1', [midi(60)])
      .bar()
      .section('Chorus')
      .beat('1', [midi(60)])
      .build();
    expect(sectionSpans(songOutline(built))).toEqual([
      { name: 'Start', fromBar: 0, toBar: 0 },
      { name: 'Verse', fromBar: 1, toBar: 2 },
      { name: 'Chorus', fromBar: 3, toBar: 3 },
    ]);
  });

  it('has none for a file without section marks', () => {
    expect(sectionSpans(songOutline(song(aMinor())))).toEqual([]);
  });
});

describe('sectionInsights', () => {
  const bars = [
    ...repeat(aMinor(), 2).map((bar, index) => (index === 0 ? { ...bar, section: 'Verse' } : bar)),
    ...repeat(aMinor(), 2).map((bar, index) => (index === 0 ? { ...bar, section: 'Chorus' } : bar)),
  ];
  const built = song(bars);
  const outline = songOutline(built);
  const insights = sectionInsights(noteTableOf(built), outline, { tonic: A, quality: 'minor' });

  it('gives each section its bars, length, key and scale', () => {
    expect(insights.map(({ name, fromBar, toBar }) => [name, fromBar, toBar])).toEqual([
      ['Verse', 0, 7],
      ['Chorus', 8, 15],
    ]);
    expect(insights[0]?.seconds).toBeCloseTo(16);
    expect(insights[0]?.key).toMatchObject({ name: 'A minor', tonic: A, quality: 'minor' });
    expect(insights[0]?.scale?.name).toBe('A natural minor');
  });

  it('fits the scale each track plays inside the section', () => {
    const tracks = insights[1]?.tracks ?? [];
    expect(tracks.map((track) => track.track)).toEqual([0, 1]);
    expect(tracks[1]?.scale?.name).toBe('A minor pentatonic');
    expect(tracks[1]?.scale?.coverage).toBeGreaterThan(0.95);
  });

  it('marks the track that plays single notes in the most beats as the solo', () => {
    expect(insights[1]?.tracks.map((track) => track.solo)).toEqual([false, true]);
  });

  it('survives a structured clone', () => {
    expect(structuredClone(insights)).toEqual(insights);
  });
});

describe('trackScales', () => {
  it('marks a track whose name says solo or lead, and skips one with too few notes', () => {
    const built = score()
      .track('piano', { name: 'Guitar 1 (Lead)' })
      .bar()
      .beat('4', [midi(57), midi(60), midi(64)])
      .beat('4', [midi(57), midi(60), midi(64)])
      .beat('4', [midi(57), midi(60), midi(64)])
      .track('piano', { name: 'Rhythm' })
      .bar()
      .beat('1', [midi(57)])
      .build();
    const table = noteTableOf(built);
    const result = trackScales(table, { tonic: A, quality: 'minor' }, [
      'Guitar 1 (Lead)',
      'Rhythm',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ track: 0, solo: true });
  });

  it('gives no scale without a key to fit against', () => {
    const table = noteTableOf(song(aMinor()));
    expect(trackScales(table, undefined, ['Chords', 'Melody']).every((t) => !t.scale)).toBe(true);
  });

  it('names a scale on the tonic the key gives', () => {
    const built = song(repeat([{ chord: chord(0), melody: run(0) }], 2));
    const [track] = trackScales(noteTableOf(built), { tonic: 0, quality: 'major' }, ['Chords']);
    expect(track?.scale?.name).toBe('C major pentatonic');
  });
});

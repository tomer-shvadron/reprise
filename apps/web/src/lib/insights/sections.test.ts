import { midi, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { noteTableOf } from './note-table';
import { songOutline } from './outline';
import { sectionInsights, sectionSpans, trackScales } from './sections';
import { chord, repeat, run, song, type SongBar } from './test/songs';

const A = 9;
/** A minor pentatonic over A, as eight eighths. */
const PENTATONIC = [69, 72, 74, 76, 79, 81, 84, 88];

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

  it('marks no solo from the texture: a melody over chords is not one', () => {
    expect(insights[1]?.tracks.map((track) => track.solo)).toEqual([false, false]);
    expect(insights.map((section) => section.solo)).toEqual([false, false]);
  });

  it('survives a structured clone', () => {
    expect(structuredClone(insights)).toEqual(insights);
  });
});

/** Four bars of eight eighths (`beat` 8) or four quarters, as a track of single notes or chords. */
function arrangement(
  tracks: readonly { name: string; notes: readonly (readonly number[])[]; beat: '4' | '8' }[],
) {
  const builder = score();
  for (const { name, notes, beat } of tracks) {
    builder.track('piano', { name });
    for (let bar = 0; bar < 4; bar++) {
      builder.bar();
      for (let slot = 0; slot < (beat === '8' ? 8 : 4); slot++) {
        builder.beat(
          beat,
          (notes[slot % notes.length] ?? []).map((pitch) => midi(pitch)),
        );
      }
    }
  }
  return builder.build();
}

const GUITAR = { name: 'Rhythm', beat: '4', notes: [[64, 69, 72, 76]] } as const;
const BASS = { name: 'Bass', beat: '8', notes: [[45], [45], [52], [45]] } as const;
const VOCALS = { name: 'Vocals', beat: '4', notes: [[84], [86], [88], [91]] } as const;
const RIFF = { name: 'Guitar', beat: '8', notes: [[57], [60], [62], [57]] } as const;

describe('trackScales', () => {
  const minor = { tonic: A, quality: 'minor' } as const;
  const soloOf = (tracks: Parameters<typeof arrangement>[0]) => {
    const built = arrangement(tracks);
    return trackScales(
      noteTableOf(built),
      minor,
      tracks.map((track) => track.name),
    ).map((t) => t.solo);
  };

  it('marks a track only when its name says solo', () => {
    expect(soloOf([GUITAR, BASS, { ...VOCALS, name: 'Guitar Solo' }])).toEqual([
      false,
      false,
      true,
    ]);
    expect(soloOf([GUITAR, BASS, { ...VOCALS, name: 'Soloist' }])).toEqual([false, false, false]);
  });

  it('marks neither a vocal melody nor a single-note riff, which are common and not solos', () => {
    expect(soloOf([GUITAR, BASS, VOCALS])).toEqual([false, false, false]);
    expect(soloOf([RIFF, { ...BASS, notes: [[45], [48], [50], [45]] }])).toEqual([false, false]);
    expect(soloOf([GUITAR, BASS, { ...GUITAR, name: 'Lead Guitar' }])).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('marks a section only when its name says solo', () => {
    const bars = [
      ...repeat(aMinor(), 2).map((bar, index) =>
        index === 0 ? { ...bar, section: 'Verse' } : bar,
      ),
      ...repeat(aMinor(), 2).map((bar, index) =>
        index === 0 ? { ...bar, section: 'Guitar Solo' } : bar,
      ),
      ...repeat(aMinor(), 2).map((bar, index) =>
        index === 0 ? { ...bar, section: 'Misleading' } : bar,
      ),
    ];
    const built = song(bars);
    const found = sectionInsights(noteTableOf(built), songOutline(built), {
      tonic: A,
      quality: 'minor',
    });
    expect(found.map((section) => section.solo)).toEqual([false, true, false]);
  });

  it('skips a track with too few notes', () => {
    const built = score()
      .track('piano', { name: 'Rhythm' })
      .bar()
      .beat('4', [midi(57), midi(60), midi(64)])
      .beat('4', [midi(57), midi(60), midi(64)])
      .beat('4', [midi(57), midi(60), midi(64)])
      .track('piano', { name: 'Few' })
      .bar()
      .beat('1', [midi(57)])
      .build();
    expect(trackScales(noteTableOf(built), minor, ['Rhythm', 'Few'])).toHaveLength(1);
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

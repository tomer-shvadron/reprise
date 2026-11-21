import { fullScore, largeScore, midi, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { analyse, analyseScore } from './analyse';
import { noteTableOf } from './note-table';
import { songOutline } from './outline';
import { chord, repeat, song, type SongBar } from './test/songs';

const A = 9;

const verse = (section?: string): SongBar[] =>
  [
    { chord: chord(A, true), name: 'Am' },
    { chord: chord(5), name: 'F' },
    { chord: chord(0), name: 'C' },
    { chord: chord(7), name: 'G' },
  ].map((bar, index) => ({
    ...bar,
    melody: [69, 71, 72, 74, 76, 77, 79, 81],
    ...(index === 0 && section ? { section } : {}),
  }));

describe('analyseScore', () => {
  const built = song([
    ...repeat(verse(), 2).map((bar, index) => (index === 0 ? { ...bar, section: 'Verse' } : bar)),
    ...repeat(verse(), 2).map((bar, index) => (index === 0 ? { ...bar, section: 'Chorus' } : bar)),
  ]);
  const insights = analyseScore(built);

  it('puts the key, scale, sections, chords, shape and tracks together', () => {
    expect(insights.key.found).toBe(true);
    if (insights.key.found) {
      expect(insights.key.name).toBe('A minor');
      expect(insights.key.runnerUpName).toBe('C major');
      expect(insights.key.scaleName).toBe('A natural minor');
      expect(insights.key.fileKeySignature).toEqual({ fifths: 0, minor: false });
    }
    expect(insights.keyChanges).toEqual([]);
    expect(insights.sections.map((section) => section.name)).toEqual(['Verse', 'Chorus']);
    expect(insights.chords.source).toBe('written');
    expect(insights.chords.progressions[0]?.label).toBe('Am–F–C–G ×2');
    expect(insights.shape.barsWritten).toBe(16);
    expect(insights.tracks.map((track) => track.name)).toEqual(['Chords', 'Melody']);
    expect(insights.tracks[0]?.scale?.name).toBe('A natural minor');
  });

  it('survives a structured clone', () => {
    expect(structuredClone(insights)).toEqual(insights);
  });

  it('gives the same answer from the table and outline a worker would receive', () => {
    const outline = songOutline(built);
    expect(analyse(noteTableOf(built), outline)).toEqual(insights);
  });
});

describe('analyse on awkward input', () => {
  it('does not throw on the full-feature score, and its answer clones', () => {
    const insights = analyseScore(fullScore());
    expect(structuredClone(insights)).toEqual(insights);
    expect(insights.tracks.length).toBeGreaterThan(0);
  });

  it('says why when there is no key and still reports the shape', () => {
    const insights = analyseScore(song([{ chord: [60] }]));
    expect(insights.key).toEqual({ found: false, reason: 'not-enough-notes' });
    expect(insights.keyChanges).toEqual([]);
    expect(insights.shape.barsWritten).toBe(1);
  });

  it('analyses a drums-only song as a shape and a drum track', () => {
    const built = score()
      .track('drums')
      .bar()
      .beat('4', [midi(36)])
      .beat('4', [midi(38)])
      .build();
    const insights = analyseScore(built);
    expect(insights.key.found).toBe(false);
    expect(insights.tracks[0]?.drums?.notes).toBe(2);
    expect(insights.chords.source).toBe('none');
  });
});

describe('analyse on the long score', () => {
  // The bench measures about 40 ms for the analysis, an order of magnitude under this bound; the
  // budget row, not this check, is what guards the number (AGENTS.md, wall-clock checks).
  it('finishes well within a sanity bound', { timeout: 60_000 }, () => {
    const built = largeScore(8, 300, { structure: true });
    const started = performance.now();
    const insights = analyseScore(built);
    const elapsed = performance.now() - started;
    expect(insights.shape.barsWritten).toBe(300);
    expect(insights.tracks).toHaveLength(8);
    expect(elapsed).toBeLessThan(2000);
  });
});

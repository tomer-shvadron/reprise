import { layout } from '@reprise/layout';
import { validateScore } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { clampRange, sliceScore } from './slice-score';

function source() {
  return score()
    .title('Slice')
    .track('guitar')
    .bar()
    .tempo(100)
    .beat('1', [note(1, 3)])
    .bar()
    .beat('1', [note(2, 5)])
    .bar({ clef: 'bass' })
    .tempo(140)
    .beat('1', [note(3, 7)])
    .bar()
    .beat('1', [note(3, 7, { tie: true })])
    .bar()
    .beat('1', [note(3, 7, { tie: true })])
    .build({ ids: 'sequential' });
}

describe('sliceScore', () => {
  it('copies the bars of the range, from every track', () => {
    const built = source();
    const slice = sliceScore(built, 1, 4);
    expect(slice.masterBars).toHaveLength(3);
    expect(slice.tracks[0]?.bars).toHaveLength(3);
    expect(slice.tracks[0]?.bars[0]?.id).toBe(built.tracks[0]?.bars[1]?.id);
  });

  it('gives the first bar the tempo in effect there', () => {
    const slice = sliceScore(source(), 1, 3);
    expect(slice.masterBars[0]?.tempo?.bpm).toBe(100);
    expect(slice.masterBars[1]?.tempo?.bpm).toBe(140);
    expect(sliceScore(source(), 3, 5).masterBars[0]?.tempo?.bpm).toBe(140);
  });

  it('gives each track the clef in effect at its first bar', () => {
    expect(sliceScore(source(), 3, 5).tracks[0]?.bars[0]?.clef).toBe('bass');
    expect(sliceScore(source(), 1, 3).tracks[0]?.bars[0]?.clef).toBeUndefined();
  });

  it('clears a tie whose origin is before the range and keeps one inside it', () => {
    const built = source();
    const slice = sliceScore(built, 3, 5);
    const [first, second] = slice.tracks[0]?.bars ?? [];
    expect(first?.voices[0].beats[0]?.notes[0]?.tie).toBe(false);
    expect(second?.voices[0].beats[0]?.notes[0]?.tie).toBe(true);
    // The tie was fine in the source; the slice is a valid score too.
    expect(validateScore(slice)).toEqual([]);
  });

  it('leaves the source untouched', () => {
    const built = source();
    const before = JSON.stringify(built);
    sliceScore(built, 3, 5);
    expect(JSON.stringify(built)).toBe(before);
  });

  it('clamps a range that runs past the score', () => {
    const slice = sliceScore(source(), 4, 99);
    expect(slice.masterBars).toHaveLength(1);
  });

  it('takes the tempo from a beat-level change before the range, not the opening mark', () => {
    // gp3 to gp5 files keep every tempo change after bar 1 on a beat.
    const built = score()
      .track('guitar')
      .bar()
      .tempo(90)
      .beat('1', [note(1, 0)])
      .bar()
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 0)], { mix: { tempo: { bpm: 140, duration: 1 } } })
      .bar()
      .beat('1', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 0)])
      .build({ ids: 'sequential' });
    expect(sliceScore(built, 2, 4).masterBars[0]?.tempo).toEqual({ bpm: 140 });
    expect(sliceScore(built, 1, 4).masterBars[0]?.tempo?.bpm).toBe(90);
  });

  it('lets a change on the first beat of the first bar win over an older mark, and a ramp keep its target', () => {
    const built = score()
      .track('guitar')
      .bar()
      .tempo(90)
      .beat('1', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 0)], { mix: { tempo: { bpm: 70, duration: 2 } } })
      .build({ ids: 'sequential' });
    expect(sliceScore(built, 1, 2).masterBars[0]?.tempo).toEqual({ bpm: 70 });
  });

  it('adds no violation beyond a volta or repeat cut at the edge', () => {
    const built = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .beat('1', [note(1, 0)])
      .bar()
      .volta([1])
      .repeatEnd()
      .beat('1', [note(1, 0)])
      .bar()
      .volta([2])
      .beat('1', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 0)])
      .build({ ids: 'sequential' });
    expect(validateScore(built)).toEqual([]);
    const allowed = new Set(['alternate-ending-outside-repeat', 'alternate-ending-order']);
    for (const [start, end] of [
      [1, 3],
      [2, 4],
      [1, 2],
      [2, 3],
    ] as const) {
      const rules = validateScore(sliceScore(built, start, end)).map(({ rule }) => rule);
      expect(
        rules.filter((rule) => !allowed.has(rule)),
        `bars ${String(start)}-${String(end)}`,
      ).toEqual([]);
    }
  });

  it('keeps each track clef apart when they change in different bars', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .bar({ clef: 'bass' })
      .beat('1', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 0)])
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 0)])
      .bar({ clef: 'alto' })
      .beat('1', [note(1, 0)])
      .build({ ids: 'sequential' });
    const slice = sliceScore(built, 2, 3);
    expect(slice.tracks.map((t) => t.bars[0]?.clef)).toEqual(['bass', 'alto']);
    expect(sliceScore(built, 1, 3).tracks.map((t) => t.bars[0]?.clef)).toEqual(['bass', undefined]);
    expect(slice.tracks.map(({ id }) => id)).toEqual(built.tracks.map(({ id }) => id));
  });

  it('lays out with the clef, key and time signature in effect at its start', () => {
    const builder = score().track('guitar', { display: { notation: 'standard', octaveShift: 1 } });
    builder.bar().beat('1', [note(1, 0)]);
    for (let i = 0; i < 3; i++) {
      builder
        .bar(i === 0 ? { clef: 'bass' } : {})
        .key(3)
        .timeSignature(3, 4)
        .beat('2.', [note(1, 0)]);
    }
    const built = builder.build({ ids: 'sequential' });
    const slice = sliceScore(built, 2, 4);
    const laid = layout(slice, {
      mode: 'paged',
      width: 794,
      pageHeight: 1123,
      zoom: 1,
      tracks: slice.tracks.map(({ id }) => id),
      notation: {},
    });
    const glyphs = laid.primitives.flatMap((p) => (p.kind === 'glyph' ? [p.glyph] : []));
    // The bass clef from bar 1, three sharps from the key, and a 3 over a 4.
    expect(glyphs).toContain('fClef8vb');
    expect(glyphs).not.toContain('gClef8vb');
    expect(glyphs.filter((name) => name === 'accidentalSharp')).toHaveLength(3);
    expect(glyphs).toEqual(expect.arrayContaining(['timeSig3', 'timeSig4']));
  });

  it('clamps a range to the score, as the filename needs', () => {
    const built = source();
    expect(clampRange(built, 3, 99)).toEqual({ start: 3, end: 5 });
    expect(clampRange(built, 99, 120)).toEqual({ start: 4, end: 5 });
    expect(clampRange(built, -2, 0)).toEqual({ start: 0, end: 1 });
  });
});

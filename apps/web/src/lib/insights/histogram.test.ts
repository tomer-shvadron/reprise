import { midi, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { pitchHistogram, sumOf } from './histogram';
import { noteTableOf } from './note-table';

const piano = (build: (b: ReturnType<typeof score>) => unknown) => {
  const builder = score().track('piano').bar();
  build(builder);
  return noteTableOf(builder.build());
};

describe('pitchHistogram', () => {
  it('weighs by duration', () => {
    const table = piano((b) => b.beat('2', [midi(60)]).beat('4', [midi(62)]));
    const h = pitchHistogram(table, { normaliseTracks: false, bass: false, metric: false });
    expect(h[0]).toBe(2);
    expect(h[2]).toBe(1);
    const counted = pitchHistogram(table, { duration: false, normaliseTracks: false, bass: false });
    expect(counted[0]).toBe(counted[2]);
  });

  it('gives a dead note nothing and a ghost note half', () => {
    const table = piano((b) =>
      b.beat('4', [midi(60, { dead: true }), midi(62, { ghost: true }), midi(64)]),
    );
    const h = pitchHistogram(table, { normaliseTracks: false, bass: false });
    expect(h[0]).toBe(0);
    expect(h[2]).toBe(0.5);
    expect(h[4]).toBe(1);
  });

  it('boosts the bass of each beat and the metric accent when asked', () => {
    const table = piano((b) => b.beat('4', [midi(48), midi(64)]));
    const flat = pitchHistogram(table, { normaliseTracks: false, bass: false });
    const bassed = pitchHistogram(table, { normaliseTracks: false });
    expect(bassed[0]).toBeGreaterThan(flat[0] ?? 0);
    expect(bassed[4]).toBe(flat[4]);
    const accented = pitchHistogram(table, { normaliseTracks: false, bass: false, metric: true });
    expect(accented[4]).toBeGreaterThan(flat[4] ?? 0);
  });

  it('normalises each track before summing', () => {
    const built = score()
      .track('piano')
      .bar()
      .beat('1', [midi(60)])
      .track('piano')
      .bar()
      .beat('16', [midi(62)])
      .build();
    const h = pitchHistogram(noteTableOf(built), { bass: false });
    expect(h[0]).toBeCloseTo(1);
    expect(h[2]).toBeCloseTo(1);
    expect(sumOf(h)).toBeCloseTo(2);
  });
});

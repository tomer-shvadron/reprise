import { describe, expect, it } from 'vitest';

import {
  ScoreSchema,
  createEmptyScore,
  createNote,
  createTrack,
  newId,
  soundingPitch,
  tieChainOf,
  validateScore,
} from './index';

describe('@reprise/model public API', () => {
  it('builds, validates and checks a score through the root export', () => {
    const score = createEmptyScore();
    expect(ScoreSchema.safeParse(score).success).toBe(true);
    expect(validateScore(score)).toEqual([]);
    expect(newId()).toHaveLength(12);
  });

  it('exports the tie chain walk', () => {
    expect(tieChainOf).toBeTypeOf('function');
  });

  it('exports the harmonic sounding pitch', () => {
    const note = createNote({ string: 1, fret: 12, harmonic: { kind: 'natural' } });
    expect(soundingPitch(createTrack('fretted'), note)).toBe(76);
  });
});

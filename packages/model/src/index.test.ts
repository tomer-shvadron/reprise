import { describe, expect, it } from 'vitest';

import {
  ScoreSchema,
  canShowTab,
  createEmptyScore,
  createNote,
  createTrack,
  newId,
  shownNotation,
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

  it('exports the tab rule', () => {
    expect(canShowTab(createTrack('pitched'))).toBe(false);
    expect(shownNotation(createTrack('fretted'), 'both')).toBe('both');
  });
});

import { describe, expect, it } from 'vitest';

import { HAND_BUILT } from './hand-built';

describe('wah marks, against alphaTab', () => {
  it('agrees on a closed mark on a note and an open mark on a rest', () => {
    const { differences, projections } = HAND_BUILT.wahOnNoteAndRest();
    expect(differences).toEqual([]);
    for (const projection of [projections.ours, projections.alphaTab]) {
      const beats = projection.tracks[0]?.bars[0]?.voices[0]?.beats ?? [];
      expect(beats.map((beat) => beat.wah)).toEqual(['closed', 'open']);
    }
  });
});

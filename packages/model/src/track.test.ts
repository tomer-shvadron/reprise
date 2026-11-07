import { describe, expect, it } from 'vitest';

import { STANDARD_TUNING } from './factories';
import { NotationSchema, canShowTab, shownNotation, type Track } from './track';

const fretted: Pick<Track, 'kind' | 'tuning'> = { kind: 'fretted', tuning: [...STANDARD_TUNING] };
const strippedFretted: Pick<Track, 'kind' | 'tuning'> = { kind: 'fretted', tuning: [] };
const keptTuning: Pick<Track, 'kind' | 'tuning'> = {
  kind: 'pitched',
  tuning: [...STANDARD_TUNING],
};
const pitched: Pick<Track, 'kind' | 'tuning'> = { kind: 'pitched', tuning: [] };
const drums: Pick<Track, 'kind' | 'tuning'> = { kind: 'drums', tuning: [] };

describe('canShowTab', () => {
  it('is true only for a fretted track with strings', () => {
    expect(canShowTab(fretted)).toBe(true);
    expect(canShowTab(strippedFretted)).toBe(false);
    expect(canShowTab(keptTuning)).toBe(false);
    expect(canShowTab(pitched)).toBe(false);
    expect(canShowTab(drums)).toBe(false);
  });
});

describe('shownNotation', () => {
  it('keeps every notation on a fretted track and on drums', () => {
    for (const wanted of NotationSchema.options) {
      expect(shownNotation(fretted, wanted)).toBe(wanted);
      expect(shownNotation(drums, wanted)).toBe(wanted);
    }
  });

  it('draws a pitched track in standard notation, with or without a kept tuning', () => {
    for (const wanted of NotationSchema.options) {
      expect(shownNotation(keptTuning, wanted)).toBe('standard');
      expect(shownNotation(pitched, wanted)).toBe('standard');
    }
  });
});

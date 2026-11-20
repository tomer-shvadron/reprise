import { describe, expect, it } from 'vitest';

import { STANDARD_TUNING } from './factories';
import {
  NotationSchema,
  VOCAL_PROGRAMS,
  canShowTab,
  isVocalTrack,
  shownNotation,
  type Track,
} from './track';

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

describe('isVocalTrack', () => {
  const of = (
    program: number,
    name: string,
    kind: Track['kind'] = 'pitched',
  ): Pick<Track, 'kind' | 'program' | 'name'> => ({ kind, program, name });

  it('knows the GM voice programs', () => {
    expect(VOCAL_PROGRAMS).toEqual([52, 53, 54]);
    for (const program of [51, 52, 53, 54, 55]) {
      expect(isVocalTrack(of(program, 'Track'))).toBe([52, 53, 54].includes(program));
    }
  });

  it.each([
    ['Vocals', true],
    ['vocal', true],
    ['Lead Vox', true],
    ['Backing voices', true],
    ['SINGER', true],
    ['Choir', true],
    ['Guitar', false],
    ['Voiceover', false],
    ['Invoice', false],
  ])('judges the name %s', (name, expected) => {
    expect(isVocalTrack(of(0, name))).toBe(expected);
  });

  it('is false on drums, even named Vocals or on a voice program', () => {
    expect(isVocalTrack(of(0, 'Vocals', 'drums'))).toBe(false);
    expect(isVocalTrack(of(53, 'Kit', 'drums'))).toBe(false);
  });
});

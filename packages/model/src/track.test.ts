import { describe, expect, it } from 'vitest';

import { STANDARD_TUNING } from './factories';
import {
  NotationSchema,
  SoundOverrideSchema,
  VOCAL_PROGRAMS,
  canShowTab,
  isVocalTrack,
  shownNotation,
  stringInstrumentOf,
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

describe('SoundOverrideSchema', () => {
  it('accepts generalMidi only as true', () => {
    expect(SoundOverrideSchema.safeParse({ generalMidi: true }).success).toBe(true);
    expect(SoundOverrideSchema.safeParse({ generalMidi: false }).success).toBe(false);
    expect(SoundOverrideSchema.safeParse({}).success).toBe(true);
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
    ['Singers', true],
    ['Choirs', true],
    ['Vocals2', true],
    ['Vocal_1', true],
    ['Lead_Vocals', true],
    ['Vocalist', false],
    ['Guitar', false],
    ['Voiceover', false],
    ['Invoice', false],
  ])('judges the name %s', (name, expected) => {
    expect(isVocalTrack(of(0, name))).toBe(expected);
  });

  it('lets the name win over a guitar program, deliberately', () => {
    // A melody named Vocals on a guitar sound is a common way to tab the vocal line; a Vox amp
    // guitar is the accepted false positive.
    expect(isVocalTrack(of(29, 'Vox Guitar'))).toBe(true);
    expect(isVocalTrack(of(29, 'Lead Guitar'))).toBe(false);
  });

  it('is false on drums, even named Vocals or on a voice program', () => {
    expect(isVocalTrack(of(0, 'Vocals', 'drums'))).toBe(false);
    expect(isVocalTrack(of(53, 'Kit', 'drums'))).toBe(false);
  });
});

describe('stringInstrumentOf', () => {
  const base: Pick<Track, 'kind' | 'program' | 'tuning' | 'courses' | 'drone'> = {
    kind: 'fretted',
    program: 25,
    tuning: [...STANDARD_TUNING],
  };

  it('names a banjo by its drone or by program 105', () => {
    expect(stringInstrumentOf({ ...base, drone: { string: 5, fret: 5 } })).toBe('banjo');
    expect(stringInstrumentOf({ ...base, program: 105 })).toBe('banjo');
  });

  it('names a 12-string by an octave course and a mandolin by four unison courses', () => {
    expect(stringInstrumentOf({ ...base, courses: [12, 12, 12, 12, 0, 0] })).toBe('twelveString');
    expect(stringInstrumentOf({ ...base, courses: [-12, null, null, null, null, null] })).toBe(
      'twelveString',
    );
    const mandolin = { ...base, tuning: [55, 62, 69, 76] };
    expect(stringInstrumentOf({ ...mandolin, courses: [0, 0, 0, 0] })).toBe('mandolin');
    expect(stringInstrumentOf({ ...mandolin, courses: [0, 0, 0, null] })).toBeUndefined();
    expect(stringInstrumentOf(mandolin)).toBeUndefined();
  });

  it('is undefined for a plain guitar and for other kinds', () => {
    expect(stringInstrumentOf(base)).toBeUndefined();
    expect(stringInstrumentOf({ ...base, kind: 'pitched', program: 105 })).toBeUndefined();
  });
});

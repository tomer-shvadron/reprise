import { describe, expect, it } from 'vitest';

import { ARTICULATION_SETS, articulationSetOf } from './sets';

describe('ARTICULATION_SETS', () => {
  it('is the camelCase vocabulary with the default first, and every name maps to itself', () => {
    expect(ARTICULATION_SETS[0]).toBe('default');
    expect(new Set(ARTICULATION_SETS).size).toBe(ARTICULATION_SETS.length);
    for (const set of ARTICULATION_SETS) expect(set).toMatch(/^[a-z][A-Za-z]*$/);
    for (const set of ARTICULATION_SETS) expect(articulationSetOf(set)).toBe(set);
  });
});

describe('articulationSetOf', () => {
  it.each([
    ['Palm Mute', 'palmMute'],
    ['palm-muted', 'palmMute'],
    ['P.M.', 'palmMute'],
    ['PM', 'palmMute'],
    ['Dead Note', 'dead'],
    ['x-note', 'dead'],
    ['Mute', 'dead'],
    ['Natural Harmonic', 'harmonic'],
    ['harmonics', 'harmonic'],
    ['NH', 'harmonic'],
    ['Pinch Harmonic', 'artificialHarmonic'],
    ['Artificial Harmonic', 'artificialHarmonic'],
    ['AH', 'artificialHarmonic'],
    ['Hammer-on', 'legato'],
    ['Pull off', 'legato'],
    ['Legato', 'legato'],
    ['H.O.', 'legato'],
    ['Staccato', 'staccato'],
    ['Tapping', 'tap'],
    ['Slap', 'slap'],
    ['Pop', 'pop'],
    ['Sustain', 'default'],
    ['Open', 'default'],
    ['Normal', 'default'],
  ] as const)('%s is %s', (label, set) => {
    expect(articulationSetOf(label)).toBe(set);
  });

  it('returns undefined for a label that names no set', () => {
    for (const label of ['', 'Chord Major', 'Pad', 'pmx']) {
      expect(articulationSetOf(label)).toBeUndefined();
    }
  });
});

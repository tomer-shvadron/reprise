import { describe, expect, it } from 'vitest';

import {
  ARTICULATION_SETS,
  articulationSetOf,
  keyOnString,
  setsOfLayers,
  splitEntry,
  voicingOf,
} from './sets';
import type { ArticulationSet, VoicingInput } from './sets';

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
    ['Stac.', 'staccato'],
    ['stac', 'staccato'],
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

const avail = (...sets: ArticulationSet[]): ReadonlySet<ArticulationSet> => new Set(sets);

function input(
  note: VoicingInput['note'],
  effects: VoicingInput['effects'] = {},
  kind: VoicingInput['kind'] = 'fretted',
): VoicingInput {
  return { kind, note, effects };
}

const ALL = avail(...ARTICULATION_SETS.filter((set) => set !== 'default'));

describe('voicingOf', () => {
  it('plays the default and drops nothing on a track with no sets (General MIDI)', () => {
    const result = voicingOf(input({ palmMute: true, dead: true }), avail());
    expect(result.set).toBe('default');
    expect(result.sampled.size).toBe(0);
  });

  it('plays the default for a dead note the pack has no dead set for, whatever else it has', () => {
    const result = voicingOf(input({ dead: true, palmMute: true }), avail('palmMute', 'staccato'));
    expect(result.set).toBe('default');
    expect(result.sampled.size).toBe(0);
  });

  it('plays the default for a drum track, whatever the pack has', () => {
    expect(voicingOf(input({ palmMute: true }, {}, 'drums'), ALL).set).toBe('default');
  });

  it.each([
    ['palm mute', { palmMute: true }, {}, 'palmMute', 'palmMute'],
    // A muted-string sample is already damped, so it carries a palm mute too.
    ['dead note', { dead: true }, {}, 'dead', ['dead', 'palmMute']],
    ['natural harmonic', { harmonic: { kind: 'natural' } }, {}, 'harmonic', 'harmonic'],
    ['pinch harmonic', { harmonic: { kind: 'pinch' } }, {}, 'artificialHarmonic', 'harmonic'],
    ['hammer-on', { hammerPull: true }, {}, 'legato', 'legato'],
    ['staccato', { staccato: true }, {}, 'staccato', undefined],
    ['tap', {}, { tapping: true }, 'tap', 'legato'],
    ['slap', {}, { slapping: true }, 'slap', undefined],
    ['pop', {}, { popping: true }, 'pop', undefined],
  ] as const)(
    'maps a %s to its set, and the effect that set carries',
    (_, note, effects, set, effect) => {
      const result = voicingOf(input(note, effects), ALL);
      expect(result.set).toBe(set);
      expect([...result.sampled]).toEqual(effect === undefined ? [] : [effect].flat());
    },
  );

  it('plays the default for a plain note, and when the pack lacks the set', () => {
    expect(voicingOf(input({}), ALL).set).toBe('default');
    const missing = voicingOf(input({ palmMute: true }), avail('harmonic'));
    expect(missing.set).toBe('default');
    expect(missing.sampled.size).toBe(0);
  });

  it('chooses by priority: dead, harmonic, palm mute, staccato, legato, slap, pop', () => {
    const note = { palmMute: true, staccato: true, hammerPull: true } as const;
    expect(voicingOf(input({ ...note, dead: true }), ALL).set).toBe('dead');
    expect(voicingOf(input({ ...note, harmonic: { kind: 'natural' } }), ALL).set).toBe('harmonic');
    expect(voicingOf(input(note), ALL).set).toBe('palmMute');
    expect(voicingOf(input({ staccato: true, hammerPull: true }), ALL).set).toBe('staccato');
    expect(voicingOf(input({ hammerPull: true }, { slapping: true }), ALL).set).toBe('legato');
    expect(voicingOf(input({}, { slapping: true, popping: true }), ALL).set).toBe('slap');
  });

  it('lets an effect the pack lacks lose to the next, which keeps the rest synthesized', () => {
    // No palm-mute set: the staccato set plays, and the palm mute is not sampled.
    const result = voicingOf(input({ palmMute: true, staccato: true }), avail('staccato'));
    expect(result.set).toBe('staccato');
    expect(result.sampled.has('palmMute')).toBe(false);
  });

  it('follows the fallback chains: an artificial harmonic to the natural one, a tap to a legato', () => {
    expect(voicingOf(input({ harmonic: { kind: 'tapped' } }), avail('harmonic')).set).toBe(
      'harmonic',
    );
    expect(voicingOf(input({}, { tapping: true }), avail('legato')).set).toBe('legato');
    expect(
      voicingOf(input({ harmonic: { kind: 'natural' } }), avail('artificialHarmonic')).set,
    ).toBe('default');
  });
});

describe('setsOfLayers', () => {
  it('maps labelled layers to sets, the first of a set winning, and skips the default and the unlabelled', () => {
    expect(
      setsOfLayers([
        { id: 'sw:24', label: 'Sustain' },
        { id: 'sw:25', label: 'Palm Mute' },
        { id: 'sw:26', label: 'PM 2' },
        { id: 'sw:27' },
        { id: 'sw:28', label: 'Chord Major' },
        { id: 'sw:29', label: 'Natural Harmonic' },
      ]),
    ).toEqual({ palmMute: { layer: 'sw:25' }, harmonic: { layer: 'sw:29' } });
  });
});

describe('splitEntry', () => {
  it('reads a plain path, a range and a list of noise keys', () => {
    expect(splitEntry('a/b.sfz')).toEqual({ path: 'a/b.sfz' });
    expect(splitEntry('b.sfz#key:75-78')).toEqual({ path: 'b.sfz', keys: [75, 76, 77, 78] });
    expect(splitEntry('b.sfz#key:91,92,95')).toEqual({ path: 'b.sfz', keys: [91, 92, 95] });
    expect(splitEntry('b.sfz#key:60, 62-63')).toEqual({ path: 'b.sfz', keys: [60, 62, 63] });
  });

  it('keeps a # that is not the key suffix in the path', () => {
    expect(splitEntry('C#.sfz')).toEqual({ path: 'C#.sfz' });
    expect(splitEntry('a#b/c.sfz#key:5')).toEqual({ path: 'a#b/c.sfz', keys: [5] });
  });

  it.each([
    'b.sfz#key:',
    'b.sfz#key:a',
    'b.sfz#key:128',
    'b.sfz#key:78-75',
    'b.sfz#key:1,,2',
    'b.sfz#key:1-11',
    'b.sfz#key:0-10',
    '#key:5',
  ])('rejects %s as a whole', (value) => {
    expect(splitEntry(value)).toBeUndefined();
  });

  it('takes ten keys and no more', () => {
    expect(splitEntry('b.sfz#key:0-9')?.keys).toHaveLength(10);
    expect(splitEntry('b.sfz#key:0-10')).toBeUndefined();
  });
});

describe('keyOnString', () => {
  const bass = { tuning: [28, 33, 38, 43] };
  const fiveBass = { tuning: [23, 28, 33, 38, 43] };
  const guitar = { tuning: [40, 45, 50, 55, 59, 64] };
  const noises = [75, 76, 77, 78];

  it('spreads the strings from the lowest, and the extra high ones take the last key', () => {
    expect([4, 3, 2, 1].map((string) => keyOnString(noises, bass, string))).toEqual([
      75, 76, 77, 78,
    ]);
    expect([5, 4, 3, 2, 1].map((string) => keyOnString(noises, fiveBass, string))).toEqual([
      75, 76, 77, 78, 78,
    ]);
    expect(
      [6, 5, 4, 3, 2, 1].map((string) => keyOnString([91, 92, 93, 94, 95], guitar, string)),
    ).toEqual([91, 92, 93, 94, 95, 95]);
  });

  it('takes the first key with no string or no tuning', () => {
    expect(keyOnString(noises, guitar, 0)).toBe(75);
    expect(keyOnString(noises, { tuning: [] }, 3)).toBe(75);
  });
});

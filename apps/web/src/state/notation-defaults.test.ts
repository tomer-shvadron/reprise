import { createTrack, type Score } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  applyNotationDefaults,
  defaultNotationOf,
  type NotationDefaults,
} from './notation-defaults';

const DEFAULTS: NotationDefaults = { strings: 'both', vocals: 'standard' };

const named = (kind: 'fretted' | 'pitched' | 'drums', name: string, program = 25) => ({
  ...createTrack(kind),
  name,
  program,
});

describe('defaultNotationOf', () => {
  it('gives a fretted track the strings default', () => {
    expect(defaultNotationOf(named('fretted', 'Guitar'), DEFAULTS)).toBe('both');
  });

  it('gives a vocal fretted track the vocals default, by program or by name', () => {
    expect(defaultNotationOf(named('fretted', 'Melody', 53), DEFAULTS)).toBe('standard');
    expect(defaultNotationOf(named('fretted', 'Vocals', 0), DEFAULTS)).toBe('standard');
  });

  it('leaves drums and pitched tracks alone', () => {
    expect(defaultNotationOf(named('drums', 'Drums'), DEFAULTS)).toBeUndefined();
    expect(defaultNotationOf(named('pitched', 'Vocals', 53), DEFAULTS)).toBeUndefined();
  });
});

describe('applyNotationDefaults', () => {
  const song = (): Score => score().track('guitar').track('bass').build();

  it('touches only the listed ids', () => {
    const before = song();
    const [first, second] = before.tracks;
    if (!first || !second) throw new Error('two tracks expected');
    const after = applyNotationDefaults(before, [first.id], DEFAULTS);
    expect(after.tracks[0]?.display.notation).toBe('both');
    expect(after.tracks[1]).toBe(second);
  });

  it('returns the same score when nothing changes', () => {
    const before = song();
    const ids = before.tracks.map((track) => track.id);
    expect(applyNotationDefaults(before, ids, { strings: 'tab', vocals: 'tab' })).toBe(before);
  });

  it('is a no-op without a list', () => {
    const before = song();
    expect(applyNotationDefaults(before, undefined, DEFAULTS)).toBe(before);
    expect(applyNotationDefaults(before, [], DEFAULTS)).toBe(before);
  });
});

import { describe, expect, it } from 'vitest';

import { beat, note, oneBar, property, rhythm } from '../../src/gpif/test/gpif-builder';
import { compareGpif } from './hand-built';

const QUARTER = [rhythm('0', 'Quarter')];
const midi = (value: number): string => property('Midi', `<Number>${String(value)}</Number>`);

describe('a track whose notes do not fit its fretboard, read as pitched', () => {
  it.each([
    [
      'a note below the lowest string',
      [note('0', 0, -2, '', midi(38)), note('1', 3, 2, '', midi(57))],
    ],
    ['a note below the lowest string, with no MIDI property', [note('0', 0, -2), note('1', 3, 2)]],
    ['a fret past the neck', [note('0', 2, 30, '', midi(80))]],
    ['two notes on one string', [note('0', 2, 5, '', midi(55)), note('1', 2, 7, '', midi(57))]],
  ])('agrees with alphaTab on %s', (name, notes) => {
    const ids = notes.map((_, index) => String(index)).join(' ');
    const result = compareGpif(name, oneBar([beat('0', '0', ids)], notes, QUARTER));
    expect(result.warnings).toContain('off-fretboard');
    expect(result.differences).toEqual([]);
  });

  it("projects alphaTab's note below the lowest string as its MIDI value", () => {
    const result = compareGpif(
      'projection',
      oneBar([beat('0', '0', '0')], [note('0', 0, -2, '', midi(38))], QUARTER),
    );
    expect(
      result.projections.alphaTab.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.notes[0],
    ).toMatchObject({ string: 0, value: 38 });
  });
});

import { courseOffset, parseNative, serializeNative, stringInstrumentOf } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { readGp, readGp3To5, writeGp } from '../src/index';
import { fixtureBytes } from './corpus';

const APP = { name: 'reprise-test', version: '0.0.0' };

/**
 * `fixtures/gp5/twelve-string.gp5` is alphaTab's `effects.gp5` with the first track's 12-string
 * flag set (`scripts/fixtures/make-twelve-string.ts`). Guitar Pro never saved it, so these tests
 * pin how Reprise reads the flag, not how Guitar Pro writes one (#348).
 */
describe('fixtures/gp5/twelve-string.gp5', () => {
  const { score: read, warnings } = readGp3To5(fixtureBytes('gp5/twelve-string.gp5'));
  const [track] = read.tracks;

  it('reads the flag as octave courses on strings 6 to 3 and unison on 2 and 1', () => {
    expect(track?.courses).toEqual([12, 12, 12, 12, 0, 0]);
    expect(track && stringInstrumentOf(track)).toBe('twelveString');
    expect(track && [6, 5, 4, 3, 2, 1].map((string) => courseOffset(track, string))).toEqual([
      12, 12, 12, 12, 0, 0,
    ]);
  });

  it('reads the same notes as the file it was made from, which has no courses', () => {
    const plain = readGp3To5(fixtureBytes('gp5/effects.gp5')).score;
    expect(plain.tracks[0]?.courses).toBeUndefined();
    expect(plain.tracks[0]?.bars.length).toBe(track?.bars.length);
    expect(warnings.map((warning) => warning.code)).toEqual(
      readGp3To5(fixtureBytes('gp5/effects.gp5')).warnings.map((warning) => warning.code),
    );
  });

  it('round-trips through the native format', () => {
    const { score: again } = parseNative(serializeNative(read, APP));
    expect(again.tracks[0]?.courses).toEqual([12, 12, 12, 12, 0, 0]);
  });

  it('exports to gp reporting the courses as lost, and reads back as single strings', () => {
    const written = writeGp(read);
    expect(written.dropped.find((entry) => entry.code === 'courses')).toMatchObject({
      path: 'score.tracks[0].courses',
      count: 1,
    });
    expect(readGp(written.bytes).score.tracks[0]?.courses).toBeUndefined();
  });
});

describe('a mandolin exported to gp', () => {
  it('reports its unison courses as a loss, since the gpif encoding is not known yet', () => {
    const mandolin = score()
      .track('mandolin')
      .bar()
      .beat('1', [note(1, 0)])
      .build();
    const written = writeGp(mandolin);
    expect(written.dropped.map((entry) => entry.code)).toEqual(['courses']);
    expect(readGp(written.bytes).score.tracks[0]?.courses).toBeUndefined();
  });

  it('reports no loss for a track of single strings', () => {
    const guitar = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .build();
    expect(writeGp(guitar).dropped).toEqual([]);
  });
});

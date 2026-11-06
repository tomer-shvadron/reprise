import { beatTicks, type Duration, type TimeSignature } from '@reprise/model';
import { parseDuration, type DurationSpec } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { beamCount, beamGrouping, beamGroups, tupletGroups, type RhythmEvent } from './grouping';

function isSpec(spec: string): spec is DurationSpec {
  return /^(1|2|4|8|16|32|64|128|256)(\.{0,2}|t)$/.test(spec);
}

/** A voice from duration specs; `r` after a spec makes it a rest. */
function voice(...specs: string[]): RhythmEvent[] {
  let tick = 0;
  return specs.map((spec) => {
    const silent = spec.endsWith('r');
    const written = spec.replace(/r$/, '');
    if (!isSpec(written)) throw new Error(`not a duration: ${spec}`);
    const rhythm = parseDuration(written);
    const ticks = beatTicks(rhythm);
    const event: RhythmEvent = { tick, ticks, ...rhythm, silent };
    tick += ticks;
    return event;
  });
}

const sig = (numerator: number, denominator: TimeSignature['denominator']): TimeSignature => ({
  numerator,
  denominator,
});

describe('beam counts', () => {
  it('gives one beam per halving from the eighth', () => {
    const durations: Duration[] = [1, 2, 4, 8, 16, 32, 64, 128, 256];
    expect(durations.map(beamCount)).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('beat grouping table', () => {
  it.each([
    [sig(4, 4), [1920, 1920], [960, 960, 960, 960]],
    [sig(3, 4), [960, 960, 960], [960, 960, 960]],
    [sig(2, 4), [960, 960], [960, 960]],
    [sig(6, 8), [1440, 1440], [1440, 1440]],
    [sig(12, 8), [1440, 1440, 1440, 1440], [1440, 1440, 1440, 1440]],
    [sig(3, 8), [1440], [1440]],
    [sig(5, 8), [960, 1440], [960, 1440]],
    [sig(7, 8), [960, 960, 1440], [960, 960, 1440]],
    [sig(2, 2), [1920], [960]],
  ])('groups %o', (signature, eighths, shorter) => {
    expect(beamGrouping(signature)).toEqual({ eighths, shorter });
  });
});

describe('beam groups', () => {
  it('beams eighths in 4/4 by half bars', () => {
    expect(beamGroups(voice('8', '8', '8', '8', '8', '8', '8', '8'), sig(4, 4))).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  it('beams sixteenths in 4/4 by quarters', () => {
    const sixteenths = Array.from({ length: 8 }, () => '16');
    expect(beamGroups(voice(...sixteenths, '4', '4'), sig(4, 4))).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  it('beams eighths in 3/4 by quarters', () => {
    expect(beamGroups(voice('8', '8', '8', '8', '8', '8'), sig(3, 4))).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it('beams 6/8 by dotted quarters, sixteenths included', () => {
    expect(beamGroups(voice('8', '8', '8', '8', '16', '16', '8'), sig(6, 8))).toEqual([
      [0, 1, 2],
      [3, 4, 5, 6],
    ]);
  });

  it('breaks beams at rests and leaves longer notes and lone beats unbeamed', () => {
    expect(beamGroups(voice('8', '8r', '8', '8', '4', '8.', '16'), sig(4, 4))).toEqual([
      [0],
      [2, 3],
      [5, 6],
    ]);
  });

  it('beams a tuplet within itself', () => {
    expect(
      beamGroups(voice('8t', '8t', '8t', '8', '8', '16t', '16t', '16t', '8'), sig(3, 4)),
    ).toEqual([[0, 1, 2], [3, 4], [5, 6, 7], [8]]);
  });
});

describe('tuplet groups', () => {
  it('closes a group when its written lengths reach n of the shortest', () => {
    expect(tupletGroups(voice('8t', '8t', '8t', '4t', '8t', '16t', '16t', '16t'))).toEqual([
      { start: 0, end: 2, n: 3, of: 2 },
      { start: 3, end: 4, n: 3, of: 2 },
      { start: 5, end: 7, n: 3, of: 2 },
    ]);
  });

  it('closes unequal values on a plain note value, as alphaTab and Guitar Pro do', () => {
    expect(tupletGroups(voice('4t', '8t', '4t', '4t', '4t', '8t', '16t', '16t', '8t'))).toEqual([
      { start: 0, end: 1, n: 3, of: 2 },
      { start: 2, end: 4, n: 3, of: 2 },
      { start: 5, end: 6, n: 3, of: 2 },
      { start: 7, end: 8, n: 3, of: 2 },
    ]);
  });

  it('counts rests inside a tuplet', () => {
    expect(tupletGroups(voice('8t', '8tr', '8t', '4'))).toEqual([
      { start: 0, end: 2, n: 3, of: 2 },
    ]);
  });
});

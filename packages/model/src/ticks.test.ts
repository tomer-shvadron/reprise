import { describe, expect, it } from 'vitest';

import type { Bar } from './bar';
import type { Beat } from './beat';
import {
  createBar,
  createBeat,
  createEmptyScore,
  createMasterBar,
  createTrack,
  createVoice,
} from './factories';
import type { MasterBar } from './master-bar';
import type { Score } from './score';
import { PPQ, barTicks, beatStartTicks, beatTicks, playedBarTicks, tickOf } from './ticks';

function barWith(...beats: Beat[]): Bar {
  return {
    ...createBar(),
    voices: [createVoice(beats), createVoice(), createVoice(), createVoice()],
  };
}

function scoreOf(masterBars: MasterBar[], bars: Bar[] = masterBars.map(() => createBar())): Score {
  return { ...createEmptyScore(), masterBars, tracks: [createTrack('fretted', { bars })] };
}

describe('beatTicks', () => {
  it('measures plain, dotted and double-dotted values at 960 PPQ', () => {
    expect(PPQ).toBe(960);
    expect(beatTicks(createBeat({ duration: 1 }))).toBe(3840);
    expect(beatTicks(createBeat({ duration: 4 }))).toBe(960);
    expect(beatTicks(createBeat({ duration: 4, dots: 1 }))).toBe(1440);
    expect(beatTicks(createBeat({ duration: 4, dots: 2 }))).toBe(1680);
    expect(beatTicks(createBeat({ duration: 256 }))).toBe(15);
  });

  it('scales tuplets, leaving fractional ticks unrounded', () => {
    expect(beatTicks(createBeat({ duration: 8, tuplet: { n: 3, of: 2 } }))).toBe(320);
    expect(beatTicks(createBeat({ duration: 16, tuplet: { n: 5, of: 4 } }))).toBe(192);
    expect(beatTicks(createBeat({ duration: 16, tuplet: { n: 7, of: 4 } }))).toBeCloseTo(
      960 / 7,
      9,
    );
    expect(beatTicks(createBeat({ duration: 8, dots: 1, tuplet: { n: 3, of: 2 } }))).toBe(480);
  });
});

describe('barTicks', () => {
  it('follows the time signature', () => {
    expect(barTicks(createMasterBar())).toBe(3840);
    expect(barTicks(createMasterBar({ timeSignature: { numerator: 3, denominator: 4 } }))).toBe(
      2880,
    );
    expect(barTicks(createMasterBar({ timeSignature: { numerator: 6, denominator: 8 } }))).toBe(
      2880,
    );
    expect(barTicks(createMasterBar({ timeSignature: { numerator: 7, denominator: 16 } }))).toBe(
      1680,
    );
  });
});

describe('beatStartTicks', () => {
  const voice = createVoice([
    createBeat({ duration: 4, dots: 1 }),
    createBeat({ duration: 8 }),
    createBeat({ duration: 8, tuplet: { n: 3, of: 2 } }),
  ]);

  it('sums the beats before the index', () => {
    expect(beatStartTicks(voice, 0)).toBe(0);
    expect(beatStartTicks(voice, 1)).toBe(1440);
    expect(beatStartTicks(voice, 2)).toBe(1920);
    expect(beatStartTicks(voice, 3)).toBe(2240);
  });

  it('rejects an index outside the voice', () => {
    expect(() => beatStartTicks(voice, 4)).toThrow(RangeError);
    expect(() => beatStartTicks(voice, -1)).toThrow(RangeError);
  });
});

describe('playedBarTicks', () => {
  it('uses the written length for an ordinary bar, even when its voices are short', () => {
    const score = scoreOf([createMasterBar()], [barWith(createBeat())]);
    expect(playedBarTicks(score, 0)).toBe(3840);
  });

  it('shortens an anacrusis to its longest voice in any track', () => {
    const masterBars = [createMasterBar({ anacrusis: true }), createMasterBar()];
    const score = scoreOf(masterBars, [barWith(createBeat()), createBar()]);
    const second = createTrack('fretted', {
      bars: [barWith(createBeat(), createBeat({ duration: 8 })), createBar()],
    });
    expect(playedBarTicks(score, 0)).toBe(960);
    expect(playedBarTicks({ ...score, tracks: [...score.tracks, second] }, 0)).toBe(1440);
  });

  it('keeps the written length for an empty anacrusis', () => {
    expect(playedBarTicks(scoreOf([createMasterBar({ anacrusis: true })]), 0)).toBe(3840);
  });
});

describe('tickOf', () => {
  const score = scoreOf(
    [
      createMasterBar({ anacrusis: true }),
      createMasterBar({ timeSignature: { numerator: 3, denominator: 4 } }),
      createMasterBar(),
    ],
    [
      barWith(createBeat()),
      barWith(createBeat(), createBeat({ duration: 2 })),
      barWith(createBeat(), createBeat()),
    ],
  );

  it('counts written order from the start of the score', () => {
    expect(tickOf(score, { bar: 0 })).toBe(0);
    expect(tickOf(score, { bar: 1 })).toBe(960);
    expect(tickOf(score, { bar: 1, beat: 1 })).toBe(1920);
    expect(tickOf(score, { bar: 2 })).toBe(3840);
    expect(tickOf(score, { bar: 2, beat: 2 })).toBe(5760);
  });

  it('rejects positions that do not exist', () => {
    expect(() => tickOf(score, { bar: 3 })).toThrow(RangeError);
    expect(() => tickOf(score, { bar: 0, beat: 1, track: 1 })).toThrow(RangeError);
    expect(() => tickOf(score, { bar: 0, beat: 5 })).toThrow(RangeError);
  });
});

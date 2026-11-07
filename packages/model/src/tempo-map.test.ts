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
import { expandPlaybackSequence } from './playback-sequence';
import type { Score } from './score';
import { DEFAULT_BPM, positionAtSeconds, secondsAt, secondsAtTick, tempoMap } from './tempo-map';
import type { TempoMap } from './tempo-map';

function barWith(...beats: Beat[]): Bar {
  return {
    ...createBar(),
    voices: [createVoice(beats), createVoice(), createVoice(), createVoice()],
  };
}

const quarters = (count: number): Beat[] => Array.from({ length: count }, () => createBeat());

function scoreOf(
  masterBars: MasterBar[],
  bars: Bar[] = masterBars.map(() => barWith(...quarters(4))),
): Score {
  return { ...createEmptyScore(), masterBars, tracks: [createTrack('fretted', { bars })] };
}

function mapOf(score: Score): TempoMap {
  return tempoMap(score, expandPlaybackSequence(score).sequence);
}

const starts = (map: TempoMap): number[] => map.passes.map((pass) => pass.startSeconds);

describe('tempoMap', () => {
  it('defaults to 120 BPM, two seconds per 4/4 bar', () => {
    expect(DEFAULT_BPM).toBe(120);
    const map = mapOf(scoreOf([createMasterBar(), createMasterBar()]));
    expect(starts(map)).toEqual([0, 2]);
    expect(map.durationSeconds).toBe(4);
    expect(map.passes.map((pass) => pass.startTick)).toEqual([0, 3840]);
  });

  it('applies a master-bar tempo change mid-song', () => {
    const map = mapOf(
      scoreOf([
        createMasterBar({ tempo: { bpm: 120 } }),
        createMasterBar(),
        createMasterBar({ tempo: { bpm: 60 } }),
        createMasterBar(),
      ]),
    );
    expect(starts(map)).toEqual([0, 2, 4, 8]);
    expect(map.durationSeconds).toBe(12);
  });

  it('keeps bpm per quarter note whatever unit the mark displays', () => {
    const map = mapOf(scoreOf([createMasterBar({ tempo: { bpm: 120, unit: 'dottedQuarter' } })]));
    expect(map.durationSeconds).toBe(2);
  });

  it('times a 3/4 to 4/4 change', () => {
    const map = mapOf(
      scoreOf(
        [
          createMasterBar({ timeSignature: { numerator: 3, denominator: 4 }, tempo: { bpm: 90 } }),
          createMasterBar(),
          createMasterBar({ timeSignature: { numerator: 6, denominator: 8 } }),
        ],
        [barWith(...quarters(3)), barWith(...quarters(4)), createBar()],
      ),
    );
    expect(starts(map)).toEqual([0, 2, 2 + 8 / 3]);
    expect(map.passes.map((pass) => pass.ticks)).toEqual([2880, 3840, 2880]);
    expect(map.durationSeconds).toBeCloseTo(2 + 8 / 3 + 2, 9);
  });

  it('shortens an anacrusis to its contents', () => {
    const map = mapOf(
      scoreOf(
        [createMasterBar({ anacrusis: true }), createMasterBar()],
        [barWith(createBeat()), barWith()],
      ),
    );
    expect(starts(map)).toEqual([0, 0.5]);
  });

  it('steps at a beat-level tempo change', () => {
    const beats = quarters(4);
    beats[2] = createBeat({ mix: { tempo: { bpm: 60 } } });
    const map = mapOf(
      scoreOf([createMasterBar(), createMasterBar()], [barWith(...beats), barWith()]),
    );
    expect(starts(map)).toEqual([0, 3]);
    expect(map.passes[0]?.segments.map((segment) => [segment.tick, segment.startBpm])).toEqual([
      [0, 120],
      [1920, 60],
    ]);
  });

  it('lets a beat-level step at the bar start override the master-bar mark', () => {
    const beats = [createBeat({ mix: { tempo: { bpm: 60 } } }), ...quarters(3)];
    const map = mapOf(scoreOf([createMasterBar({ tempo: { bpm: 240 } })], [barWith(...beats)]));
    expect(map.durationSeconds).toBe(4);
  });

  it('ramps a beat-level change at the bar start from the master-bar mark', () => {
    const beats = [createBeat({ mix: { tempo: { bpm: 120, duration: 4 } } }), ...quarters(3)];
    const map = mapOf(scoreOf([createMasterBar({ tempo: { bpm: 60 } })], [barWith(...beats)]));
    expect(map.passes[0]?.segments[0]).toMatchObject({ startBpm: 60, endBpm: 120 });
    expect(map.durationSeconds).toBeCloseTo(4 * Math.log(2), 9);
  });

  it('ramps linearly in BPM over the transition, across the bar line', () => {
    const beats = [createBeat({ mix: { tempo: { bpm: 60, duration: 8 } } }), ...quarters(3)];
    const map = mapOf(
      scoreOf(
        [createMasterBar(), createMasterBar(), createMasterBar()],
        [barWith(...beats), barWith(), barWith()],
      ),
    );
    // 60·T / (PPQ·Δbpm) · ln(end / start): 120 to 90 over the first bar, 90 to 60 over the second.
    const first = -8 * Math.log(90 / 120);
    const second = -8 * Math.log(60 / 90);
    expect(map.passes[0]?.durationSeconds).toBeCloseTo(first, 9);
    expect(map.passes[1]?.durationSeconds).toBeCloseTo(second, 9);
    expect(map.passes[2]?.durationSeconds).toBeCloseTo(4, 9);
    expect(map.passes[1]?.segments[0]).toMatchObject({ startBpm: 90, endBpm: 60 });
  });

  it('starts a new change from the tempo a ramp had reached', () => {
    const beats = [
      createBeat({ mix: { tempo: { bpm: 60, duration: 4 } } }),
      createBeat(),
      createBeat({ mix: { tempo: { bpm: 200 } } }),
      createBeat(),
    ];
    const map = mapOf(scoreOf([createMasterBar()], [barWith(...beats)]));
    expect(map.passes[0]?.segments.map((segment) => [segment.startBpm, segment.endBpm])).toEqual([
      [120, 90],
      [200, 200],
    ]);
  });

  it('carries the tempo in playback order through a repeat', () => {
    const beats = [createBeat({ mix: { tempo: { bpm: 60 } } }), ...quarters(3)];
    const score = scoreOf(
      [
        createMasterBar({ repeat: { start: true, endCount: 0 } }),
        createMasterBar({ repeat: { start: false, endCount: 2 } }),
      ],
      [barWith(...quarters(4)), barWith(...beats)],
    );
    expect(starts(mapOf(score))).toEqual([0, 2, 6, 10]);
  });

  it('is empty for an empty sequence', () => {
    const map = tempoMap(scoreOf([createMasterBar()]), []);
    expect(map.passes).toEqual([]);
    expect(map.durationSeconds).toBe(0);
    expect(positionAtSeconds(map, 1)).toBeUndefined();
  });
});

describe('secondsAt and positionAtSeconds', () => {
  const eighths = Array.from({ length: 8 }, () => createBeat({ duration: 8 }));
  const score: Score = {
    ...scoreOf(
      [
        createMasterBar({ repeat: { start: true, endCount: 0 } }),
        createMasterBar({ repeat: { start: false, endCount: 2 }, tempo: { bpm: 60 } }),
      ],
      [
        barWith(...quarters(4)),
        barWith(createBeat({ mix: { tempo: { bpm: 180, duration: 2 } } }), ...quarters(3)),
      ],
    ),
  };
  score.tracks.push(createTrack('fretted', { bars: [barWith(...eighths), barWith(...eighths)] }));
  const map = mapOf(score);

  it('finds the bar pass, beat and progress', () => {
    expect(positionAtSeconds(map, 1.25)).toEqual({
      sequenceIndex: 0,
      masterBarIndex: 0,
      passIndex: 0,
      tick: 2400,
      playbackTick: 2400,
      barProgress: 0.625,
      beatIndex: 2,
      beatProgress: 0.5,
    });
    expect(positionAtSeconds(map, 1.25, { track: 1 })).toMatchObject({
      beatIndex: 5,
      beatProgress: 0,
    });
  });

  it('tells repeat passes apart', () => {
    const second = map.passes[2];
    expect(second).toMatchObject({ masterBarIndex: 0, passIndex: 1 });
    expect(positionAtSeconds(map, (second?.startSeconds ?? 0) + 0.01)).toMatchObject({
      sequenceIndex: 2,
      masterBarIndex: 0,
      passIndex: 1,
      beatIndex: 0,
    });
  });

  it('inverts secondsAt, including inside a ramp', () => {
    for (const [sequenceIndex, pass] of map.passes.entries()) {
      for (const tick of [0, 100, 960, 1500, 1920, 3000, 3839]) {
        const position = positionAtSeconds(map, secondsAt(map, sequenceIndex, tick));
        expect(position?.sequenceIndex).toBe(sequenceIndex);
        expect(position?.tick).toBeCloseTo(tick, 6);
      }
      expect(secondsAt(map, sequenceIndex, pass.ticks)).toBeCloseTo(
        pass.startSeconds + pass.durationSeconds,
        9,
      );
    }
  });

  it('clamps to the start and the end', () => {
    expect(positionAtSeconds(map, -5)).toMatchObject({
      sequenceIndex: 0,
      tick: 0,
      beatIndex: 0,
      beatProgress: 0,
    });
    expect(positionAtSeconds(map, map.durationSeconds + 5)).toMatchObject({
      sequenceIndex: 3,
      tick: 3840,
      barProgress: 1,
      beatIndex: 3,
      beatProgress: 1,
    });
  });

  it('reports no beat for an empty voice and the last beat past the end of a short voice', () => {
    expect(positionAtSeconds(map, 0.5, { voice: 1 })).toMatchObject({
      beatIndex: undefined,
      beatProgress: 0,
    });
    const short = mapOf(scoreOf([createMasterBar()], [barWith(createBeat())]));
    expect(positionAtSeconds(short, 1.5)).toMatchObject({ beatIndex: 0, beatProgress: 1 });
  });

  it('counts playback ticks across passes, and secondsAtTick inverts them', () => {
    for (const [sequenceIndex, pass] of map.passes.entries()) {
      for (const tick of [0, 1500, 3000]) {
        const seconds = secondsAt(map, sequenceIndex, tick);
        expect(positionAtSeconds(map, seconds)?.playbackTick).toBeCloseTo(pass.startTick + tick, 6);
        expect(secondsAtTick(map, pass.startTick + tick)).toBeCloseTo(seconds, 9);
      }
    }
    expect(secondsAtTick(map, -10)).toBe(0);
    expect(secondsAtTick(map, 1e9)).toBeCloseTo(map.durationSeconds, 9);
    expect(secondsAtTick(tempoMap(map.score, []), 100)).toBe(0);
  });

  it('rejects a sequence index outside the map', () => {
    expect(() => secondsAt(map, 4, 0)).toThrow(RangeError);
  });
});

describe('an over-full bar', () => {
  const overfull = (first: Beat[] = quarters(6)): Score =>
    scoreOf([createMasterBar(), createMasterBar()], [barWith(...first), barWith(...quarters(4))]);

  it('times the bar to its longest voice and starts the next bar after it', () => {
    const map = mapOf(overfull());
    expect(map.passes[0]).toMatchObject({ ticks: 5760, durationSeconds: 3 });
    expect(map.passes[1]).toMatchObject({ startTick: 5760, startSeconds: 3 });
    expect(map.durationSeconds).toBe(5);
    expect(secondsAtTick(map, 4800)).toBe(2.5);
  });

  it('applies a tempo change on a beat past the written end', () => {
    const beats = quarters(6);
    beats[4] = createBeat({ mix: { tempo: { bpm: 60 } } });
    const map = mapOf(overfull(beats));
    expect(map.passes[0]?.durationSeconds).toBe(4);
  });

  it('finds positions inside the overflow', () => {
    expect(positionAtSeconds(mapOf(overfull()), 2.25)).toMatchObject({
      masterBarIndex: 0,
      tick: 4320,
      beatIndex: 4,
      beatProgress: 0.5,
      barProgress: 0.75,
    });
  });
});

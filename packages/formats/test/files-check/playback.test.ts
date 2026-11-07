import { expandPlaybackSequence, tempoMap } from '@reprise/model';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { read, writeGp } from '../../src/index';
import { fixtureBytes } from '../corpus';
import { loadWithAlphaTab } from '../oracle/project-alphatab';
import {
  alphaTabPlayback,
  compareOrder,
  compareTempo,
  detectDeviations,
  guardTickLookup,
  isOverfull,
  longestVoiceTicks,
  overfullShape,
  runLength,
} from './playback';

async function compare(bytes: Uint8Array) {
  const { score: ours, warnings } = await read(bytes);
  const at = loadWithAlphaTab(bytes);
  const sequence = expandPlaybackSequence(ours);
  const playback = alphaTabPlayback(at);
  const order = compareOrder(
    sequence.sequence.map((pass) => pass.masterBarIndex),
    playback,
    detectDeviations(ours, sequence.warnings),
    { ours: ours.masterBars.length, alphaTab: at.masterBars.length },
  );
  const tempoMoved = warnings.some((warning) => warning.code === 'tempo-moved');
  return { order, tempo: () => compareTempo(ours, sequence.sequence, playback, tempoMoved) };
}

const bar = (builder: ReturnType<typeof score>): ReturnType<typeof score> =>
  builder.bar().beat('1', [note(1, 0)]);

describe('the order check', () => {
  it.each([
    'gp5/directions.gp5',
    'gp5/repeat-close-alternate-endings.gp5',
    'gpx/repeat-close-alternate-endings.gpx',
  ])('finds %s in the same order as alphaTab', async (fixture) => {
    const { order } = await compare(fixtureBytes(fixture));
    expect(order).toMatchObject({ identical: true, violations: [] });
  });

  it('explains a D.S. on a repeat end as a documented deviation', async () => {
    let builder = score().tempo(120).track('guitar');
    builder = bar(builder).target('segno');
    builder = bar(builder).repeatStart();
    builder = bar(builder).repeatEnd(2).jump('dalSegno');
    builder = bar(builder);
    const { order } = await compare(writeGp(builder.build()).bytes);
    expect(order.identical).toBe(false);
    expect(order.violations).toEqual([]);
    expect(order.explained.map((entry) => entry.id)).toContain('return-jump-on-repeat-end');
  });

  /** 1, |: 2, [1. 3 :|, [2. 4, 5 (segno), 6, 7 (D.S.), 8, 9: a D.S. in a song with voltas. */
  const dalSegnoWithVoltas = (): Score => {
    let builder = score().tempo(120).track('guitar');
    builder = bar(builder);
    builder = bar(builder).repeatStart();
    builder = bar(builder).volta([1]).repeatEnd(2);
    builder = bar(builder).volta([2]);
    builder = bar(builder).target('segno');
    builder = bar(builder);
    builder = bar(builder).jump('dalSegno');
    builder = bar(builder);
    builder = bar(builder);
    return builder.build();
  };

  it('fails an unrelated divergence after a bar a detector flags', async () => {
    const song = dalSegnoWithVoltas();
    const bytes = writeGp(song).bytes;
    const { score: ours } = await read(bytes);
    const sequence = expandPlaybackSequence(ours);
    const playback = alphaTabPlayback(loadWithAlphaTab(bytes));
    const deviations = detectDeviations(ours, sequence.warnings);
    expect([...deviations.keys()]).toContain('voltas-after-return-jump');
    const order = sequence.sequence.map((pass) => pass.masterBarIndex);
    const counts = { ours: ours.masterBars.length, alphaTab: ours.masterBars.length };
    expect(compareOrder(order, playback, deviations, counts).identical).toBe(true);
    // One extra pass of the last bar: a bug at pass 14, away from any volta.
    const result = compareOrder([...order, 8], playback, deviations, counts);
    expect(result.explained).toEqual([]);
    expect(result.violations).toEqual([
      expect.objectContaining({
        code: 'order-differs',
        where: 'pass 14: ours bar 9, alphaTab end',
      }),
    ]);
  });

  it('explains a divergence at a volta after a return jump', async () => {
    // 1 (segno), |: 2, [1. 3 :|, [2. 4, 5 (D.S.), 6: after the D.S. ours plays only ending 2.
    let builder = score().tempo(120).track('guitar');
    builder = bar(builder).target('segno');
    builder = bar(builder).repeatStart();
    builder = bar(builder).volta([1]).repeatEnd(2);
    builder = bar(builder).volta([2]);
    builder = bar(builder).jump('dalSegno');
    builder = bar(builder);
    const { order } = await compare(writeGp(builder.build()).bytes);
    expect(order.identical).toBe(false);
    expect(order.violations).toEqual([]);
    expect(order.explained.map((entry) => entry.id)).toEqual(['voltas-after-return-jump']);
  });

  it('fails a divergence at a volta when no return jump was taken before it', () => {
    const song = dalSegnoWithVoltas();
    const deviations = detectDeviations(song, []);
    const playback = {
      guardFired: false,
      passes: [0, 1, 2].map((masterBarIndex) => ({
        masterBarIndex,
        start: 0,
        end: 0,
        tempoChanges: [],
      })),
    };
    const result = compareOrder([0, 1, 3], playback, deviations, { ours: 9, alphaTab: 9 });
    expect(result.violations.map((v) => v.code)).toEqual(['order-differs']);
  });

  it('reports a divergence no detector explains', () => {
    const playback = {
      guardFired: false,
      passes: [0, 2, 1].map((masterBarIndex) => ({
        masterBarIndex,
        start: 0,
        end: 0,
        tempoChanges: [],
      })),
    };
    const result = compareOrder([0, 1, 2], playback, new Map(), { ours: 3, alphaTab: 3 });
    expect(result.violations).toEqual([
      expect.objectContaining({
        code: 'order-differs',
        where: 'pass 2: ours bar 2, alphaTab bar 3',
      }),
    ]);
  });

  it('explains any divergence once alphaTab looped', () => {
    const playback = {
      guardFired: true,
      passes: [{ masterBarIndex: 1, start: 0, end: 0, tempoChanges: [] }],
    };
    const result = compareOrder([0], playback, new Map(), { ours: 2, alphaTab: 2 });
    expect(result.explained.map((entry) => entry.id)).toEqual(['jump-fires-once']);
  });
});

describe('the tempo check', () => {
  it('explains the mid-beat change the reader moves in beat-tempo-change.gp', async () => {
    const { order, tempo } = await compare(fixtureBytes('gp/beat-tempo-change.gp'));
    expect(order.identical).toBe(true);
    const result = tempo();
    expect(result.violations).toEqual([]);
    expect(result.explained.map((entry) => entry.id)).toEqual(['tempo-moved']);
  });

  it('passes a plain tempo change', async () => {
    let builder = score().tempo(100).track('guitar');
    builder = bar(builder);
    builder = bar(builder).tempo(140);
    const { tempo } = await compare(writeGp(builder.build()).bytes);
    expect(tempo()).toMatchObject({ violations: [], explained: [] });
  });

  const overfullSong = (): Score =>
    score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 1)])
      .beat('4', [note(1, 2)])
      .bar()
      .beat('1', [note(1, 3)])
      .build({ validate: false });

  /** alphaTab's view: bar 1 keeps its written 3840 ticks, the overflow sounds in bar 2. */
  const alphaTabOf = (tempoChanges: { tick: number; tempo: number }[] = []) => ({
    guardFired: false,
    passes: [
      {
        masterBarIndex: 0,
        start: 0,
        end: 3840,
        tempoChanges: [{ tick: 0, tempo: 120 }, ...tempoChanges],
      },
      { masterBarIndex: 1, start: 3840, end: 7680, tempoChanges: [] },
    ],
  });

  it('explains a pass of an over-full bar that lasts its longest voice', () => {
    const song = overfullSong();
    expect(isOverfull(song, 0)).toBe(true);
    expect(isOverfull(song, 1)).toBe(false);
    const sequence = expandPlaybackSequence(song).sequence;
    expect(tempoMap(song, sequence).passes[0]?.ticks).toBe(4800);
    const result = compareTempo(song, sequence, alphaTabOf(), false);
    expect(result.violations).toEqual([]);
    expect(result.explained.map((entry) => entry.id)).toEqual(['overfull-bar']);
  });

  it('fails an over-full pass two beats longer than its longest voice', () => {
    expect(overfullShape(overfullSong(), 0, 4800, 3840)).toBeUndefined();
    expect(overfullShape(overfullSong(), 0, 4800 + 1920, 3840)).toBe(
      "the over-full pass lasts 6720 ticks, not its longest voice's 4800",
    );
    expect(overfullShape(overfullSong(), 0, 4800, 4800)).toMatch(/not the written 3840/);
  });

  it('fails an over-full pass whose alphaTab length is not the written one', () => {
    const song = overfullSong();
    const sequence = expandPlaybackSequence(song).sequence;
    const playback = alphaTabOf();
    const [first, second] = playback.passes;
    if (!first || !second) throw new Error('two passes');
    first.end = 4800;
    second.start = 4800;
    second.end = 8640;
    const result = compareTempo(song, sequence, playback, false);
    expect(result.violations.map((v) => v.code)).toEqual(['pass-length']);
    expect(result.explained).toEqual([]);
  });

  it('fails a misplaced tempo change inside the written length of an over-full bar', () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 1)], { mix: { tempo: { bpm: 90 } } })
      .beat('4', [note(1, 2)])
      .bar()
      .beat('1', [note(1, 3)])
      .build({ validate: false });
    const sequence = expandPlaybackSequence(song).sequence;
    const result = compareTempo(song, sequence, alphaTabOf([{ tick: 960, tempo: 90 }]), false);
    expect(result.violations.map((v) => v.code)).toEqual(['tempo-differs']);
  });

  it('ignores a voice of only empty beats when finding the longest voice', () => {
    const song = overfullSong();
    const voice = song.tracks[0]?.bars[1]?.voices[0];
    const empty = voice?.beats[0];
    if (!voice || !empty) throw new Error('bar 2 has a beat');
    song.tracks[0]?.bars[1]?.voices.push({
      ...voice,
      beats: Array.from({ length: 6 }, () => ({ ...empty, notes: [], rest: false })),
    });
    expect(longestVoiceTicks(song, 1)).toBe(3840);
    expect(isOverfull(song, 1)).toBe(false);
  });
});

describe('the deviation detectors', () => {
  const ids = (built: Score): string[] =>
    [...detectDeviations(built, expandPlaybackSequence(built).warnings).keys()].sort();

  it('flag a return jump on a repeat end and voltas after a return jump', () => {
    let builder = score().track('guitar');
    builder = bar(builder).repeatStart();
    builder = bar(builder).volta([1]);
    builder = bar(builder).volta([2]).repeatEnd(2).jump('daCapo');
    expect(ids(builder.build({ validate: false }))).toEqual([
      'jump-on-volta',
      'return-jump-on-repeat-end',
      'voltas-after-return-jump',
    ]);
  });

  it('flag a nested repeat start', () => {
    let builder = score().track('guitar');
    builder = bar(builder).repeatStart();
    builder = bar(builder).repeatStart();
    builder = bar(builder).repeatEnd(2);
    builder = bar(builder).repeatEnd(2);
    expect(ids(builder.build({ validate: false }))).toContain('nested-repeat-start');
  });

  it('flag several repeat ends in a section with voltas', () => {
    let builder = score().track('guitar');
    builder = bar(builder).repeatStart();
    builder = bar(builder).repeatEnd(2);
    builder = bar(builder).volta([1]);
    builder = bar(builder).repeatEnd(2);
    expect(ids(builder.build({ validate: false }))).toContain('several-repeat-ends-with-voltas');
  });

  it('flag an unmatched repeat end after a coda', () => {
    let builder = score().track('guitar');
    builder = bar(builder).jump('toCoda');
    builder = bar(builder).jump('dcAlCoda');
    builder = bar(builder).target('coda');
    builder = bar(builder).repeatEnd(2);
    const built = builder.build({ validate: false });
    expect(
      detectDeviations(built, [
        { code: 'repeat-end-without-start', masterBarIndex: 3, message: '' },
      ])
        .get('unmatched-end-after-coda')
        ?.map((deviation) => deviation.bar),
    ).toEqual([3]);
  });

  it('flag nothing on a plain repeat', () => {
    let builder = score().track('guitar');
    builder = bar(builder).repeatStart();
    builder = bar(builder).repeatEnd(2);
    expect(ids(builder.build())).toEqual([]);
  });
});

describe('the loop guard', () => {
  it('stops a tick lookup after its limit', () => {
    const added: number[] = [];
    const lookup = {
      addMasterBar: (bar: number) => {
        added.push(bar);
      },
    };
    guardTickLookup(lookup, 3);
    const add = (): void => {
      lookup.addMasterBar(added.length);
    };
    add();
    add();
    add();
    expect(add).toThrow('more than 3 passes');
    expect(added).toHaveLength(3);
  });
});

describe('runLength', () => {
  it('breaks runs at every backward jump, 1-based', () => {
    expect(runLength([0, 1, 2, 0, 1, 3, 4, 5])).toBe('1–3, 1–2, 4–6');
    expect(runLength([0, 2])).toBe('1, 3');
    expect(runLength([])).toBe('');
  });
});

import { expandPlaybackSequence } from '@reprise/model';
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
      ]).get('unmatched-end-after-coda'),
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

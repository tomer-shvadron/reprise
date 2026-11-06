import {
  applyCommand,
  setNoteEffect,
  type Dynamics,
  type Notation,
  type Score,
} from '@reprise/model';
import { largeScore, note, noteOf, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, PAGE_SIZES, layout, type LayoutOptions, type LayoutResult } from '../index';
import { expectValid, stable } from '../test/check-result';
import { reservedDynamics, shownDynamics } from './dynamics';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

/** The dynamics each staff draws, left to right, by staff type. */
function dynamicsByStaff(result: LayoutResult): Record<string, string[]> {
  const staves = result.anchors.filter((anchor) => anchor.kind === 'staff');
  const out: Record<string, { x: number; name: string }[]> = {};
  for (const p of result.primitives) {
    if (p.kind !== 'glyph' || !p.glyph.startsWith('dynamic')) continue;
    const middle = p.bbox.y + p.bbox.height / 2;
    const staff = staves.find(({ bbox }) => middle >= bbox.y && middle <= bbox.y + bbox.height);
    const key = staff?.staff ?? 'none';
    (out[key] ??= []).push({ x: p.x, name: p.glyph.replace('dynamic', '') });
  }
  return Object.fromEntries(
    Object.entries(out).map(([key, list]) => [
      key,
      list.sort((a, b) => a.x - b.x).map((d) => d.name),
    ]),
  );
}

/** The two bars of #76: a dynamic skipped at one onset must not hide a later return. */
function issue76(notation: Notation): Score {
  const d = (dynamics: Dynamics) => ({ dynamics });
  return score()
    .track('guitar', { display: { notation, octaveShift: 1 } })
    .bar()
    .beat('8', [note(1, 0, d('pp'))])
    .beat('8', [note(1, 0, d('f'))])
    .beat('4', [note(1, 0, d('f'))])
    .beat('2', [note(1, 0, d('pp'))])
    .voice(1)
    .beat('2', [note(4, 0, d('f'))])
    .beat('2', [note(4, 0, d('f'))])
    .bar()
    .beat('4', [note(1, 0, d('mf'))])
    .rest('8')
    .beat('8', [note(1, 0, d('f'))])
    .beat('2', [note(1, 0, d('mf'))])
    .build({ ids: 'sequential' });
}

const PRINTED = ['PP', 'Forte', 'PP', 'MF', 'Forte', 'MF'];

describe('dynamics: one rule on every staff', () => {
  it("prints #76's two bars as pp f pp | mf f mf on the tab, standard-only and both mode", () => {
    for (const notation of ['tab', 'standard'] as const) {
      const result = layout(issue76(notation), paged);
      expectValid(result);
      expect(dynamicsByStaff(result)).toEqual({ [notation]: PRINTED });
    }
    const both = layout(issue76('both'), paged);
    expectValid(both);
    expect(dynamicsByStaff(both)).toEqual({ standard: PRINTED });
  });

  it('compares across bars of rests with the voice last played', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0, { dynamics: 'p' })])
      .bar()
      .rest('1')
      .bar()
      .rest('1')
      .bar()
      .beat('2', [note(1, 0, { dynamics: 'p' })])
      .beat('2', [note(1, 0, { dynamics: 'mf' })])
      .build({ ids: 'sequential' });
    for (const notation of ['tab', 'standard'] as const) {
      const result = layout(built, {
        ...paged,
        notation: { [built.tracks[0]?.id ?? '']: notation },
      });
      expect(dynamicsByStaff(result)[notation]).toEqual(['Piano', 'MF']);
    }
  });

  it('reserves room in every bar for each dynamic it may show', () => {
    const levels: Dynamics[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
    const varied = largeScore(2, 60, { structure: true });
    for (const [t, track] of varied.tracks.entries()) {
      for (const [b, bar] of track.bars.entries()) {
        for (const voice of bar.voices) {
          for (const [i, beat] of voice.beats.entries()) {
            for (const n of beat.notes)
              n.dynamics = levels[(t + b * 3 + Math.floor(i / 3)) % 5] ?? 'f';
          }
        }
      }
    }
    let shownCount = 0;
    for (const track of varied.tracks) {
      for (const [index, bar] of track.bars.entries()) {
        const reserved = reservedDynamics(bar);
        for (const id of shownDynamics(track, index).keys()) {
          shownCount += 1;
          expect(reserved.has(id)).toBe(true);
        }
      }
    }
    expect(shownCount).toBeGreaterThan(100);
  });

  it('keeps a cached layout equal to a cold one when an earlier dynamic changes a later bar', () => {
    const builder = score().track('guitar');
    builder.bar().beat('1', [note(1, 0, { dynamics: 'f' })]);
    builder.bar().beat('1', [note(1, 0, { dynamics: 'p' })]);
    for (let b = 0; b < 2; b++) builder.bar().rest('1');
    builder.bar().beat('1', [note(1, 0, { dynamics: 'p' })]);
    for (let b = 0; b < 30; b++) builder.bar().beat('1', [note(1, 0, { dynamics: 'p' })]);
    const before = builder.build({ ids: 'sequential' });
    const cache = new LayoutCache();
    const first = layout(before, paged, cache);
    expect(dynamicsByStaff(first)['tab']).toEqual(['Piano']);

    const { score: after, change } = applyCommand(
      before,
      setNoteEffect({ noteId: noteOf(before, 0, 1, 0).id }, { dynamics: 'mf' }),
    );
    const cached = layout(after, { ...paged, dirtyBars: change.touchedBars }, cache);
    expect(cached.metrics.measuredBars).toBe(1);
    expect(stable(cached)).toBe(stable(layout(after, paged)));
    expect(dynamicsByStaff(cached)['tab']).toEqual(['MF', 'Piano']);
  });
});

import { read, write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { beatOf, note, noteOf, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  BEND_AMOUNTS,
  BEND_SHAPES,
  bendPreset,
  bendPresetLabel,
  type BendAmount,
} from './bend-presets';
import { WHAMMY_AMOUNTS, WHAMMY_SHAPES, whammyPreset, type WhammyAmount } from './whammy-presets';

const amounts = Object.keys(BEND_AMOUNTS) as BendAmount[];
const whammyAmounts = Object.keys(WHAMMY_AMOUNTS) as WhammyAmount[];

/** Writes the score as gp and reads it back, with the writer's own list of what it lost. */
async function roundTrip(built: Score) {
  const { bytes, dropped } = await write(built, 'gp');
  const { score: back } = await read(bytes, 'gp');
  return { back, dropped };
}

describe('the bend presets', () => {
  it('are the four shapes in three sizes, in quarter tones, within the model range', () => {
    expect(bendPreset('bend', 'full').points).toEqual([
      { position: 0, value: 0 },
      { position: 15, value: 4 },
      { position: 60, value: 4 },
    ]);
    expect(bendPreset('prebendRelease', 'quarter').points).toEqual([
      { position: 0, value: 1 },
      { position: 30, value: 1 },
      { position: 60, value: 0 },
    ]);
    expect(bendPresetLabel('bendRelease', 'half')).toBe('½ bend and release');
    for (const shape of BEND_SHAPES) {
      expect(bendPreset(shape, 'half').kind).toBe(shape);
    }
  });

  for (const shape of BEND_SHAPES) {
    for (const amount of amounts) {
      it(`survive Guitar Pro export: ${amount} ${shape}`, async () => {
        const bend = bendPreset(shape, amount);
        const built = score()
          .track('guitar')
          .bar()
          .beat('4', [note(2, 7, { bend })])
          .build();
        const { back, dropped } = await roundTrip(built);
        expect(dropped.map(({ code }) => code)).not.toContain('bend-shape');
        expect(noteOf(back, 0, 0, 0).bend).toEqual(bend);
      });
    }
  }
});

describe('the whammy presets', () => {
  it('are a dive, a dip and a release up, in quarter tones below rest', () => {
    expect(whammyPreset('dip', 'medium').points).toEqual([
      { position: 0, value: 0 },
      { position: 30, value: -4 },
      { position: 60, value: 0 },
    ]);
  });

  for (const shape of WHAMMY_SHAPES) {
    for (const amount of whammyAmounts) {
      it(`survive Guitar Pro export: ${amount} ${shape}`, async () => {
        const whammy = whammyPreset(shape, amount);
        const built = score()
          .track('guitar')
          .bar()
          .beat('4', [note(2, 7)], { effects: { whammy } })
          .build();
        const { back, dropped } = await roundTrip(built);
        expect(dropped.map(({ code }) => code)).not.toContain('whammy-shape');
        expect(beatOf(back, 0, 0, 0).effects.whammy).toEqual(whammy);
      });
    }
  }
});

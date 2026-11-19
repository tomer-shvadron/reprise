import { applyCommand, setBeatRest, type Clef, type Score } from '@reprise/model';
import { beatOf, midi, score, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, PAGE_SIZES, layout, type LayoutOptions } from '../../index';
import { expectValid, restsOnHeads, stable, strayPrimitives } from '../../test/check-result';
import type { StaffBar } from '../staff-module';
import { positionY } from './chord';
import { planBar, restBounds, type BarPlan, type BeatPlan } from './plan';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};
const SPACE = 7;
const CLEAR = 0.25 * SPACE - 1e-6;

const piano = (): ScoreBuilder =>
  score().track('piano', { display: { notation: 'standard', octaveShift: 0 } });

function staffBar(built: Score, barIndex: number, clef: Clef = 'treble'): StaffBar {
  const track = built.tracks[0];
  const bar = track?.bars[barIndex];
  const masterBar = built.masterBars[barIndex];
  if (!track || !bar || !masterBar) throw new Error('no such bar');
  return {
    score: built,
    track,
    trackIndex: 0,
    staves: ['standard'],
    bar,
    masterBar,
    barIndex,
    clef,
    keySignature: masterBar.keySignature,
    space: SPACE,
  };
}

function plan(built: Score, barIndex = 0, percussion = false): BarPlan {
  return planBar(staffBar(built, barIndex, percussion ? 'percussion' : 'treble'), {
    percussion,
    courtesyAccidentals: false,
  });
}

function laid(built: Score, options: Partial<LayoutOptions> = {}) {
  const result = layout(built, { ...paged, ...options });
  expectValid(result);
  return result;
}

const at = (p: BarPlan, voice: number, tick: number): BeatPlan => {
  const found = p.beats.find((beat) => beat.voice === voice && Math.abs(beat.tick - tick) < 1e-6);
  if (!found) throw new Error(`no beat at ${String(voice)}/${String(tick)}`);
  return found;
};

const headSpan = (beat: BeatPlan): { top: number; bottom: number } => {
  const ys = (beat.chord?.heads ?? []).map(({ y }) => y);
  return { top: Math.min(...ys) - SPACE / 2, bottom: Math.max(...ys) + SPACE / 2 };
};

describe('rests of two voices', () => {
  it('keeps a lower voice rest clear of the upper voice head at its onset', () => {
    const built = piano()
      .bar()
      .rest('4')
      .beat('4', [midi(64)])
      .beat('4', [midi(69)])
      .beat('4', [midi(71)])
      .voice(1)
      .beat('4', [midi(55)])
      .rest('4')
      .rest('4')
      .rest('4')
      .build({ ids: 'sequential' });
    const p = plan(built);
    for (const tick of [960, 1920, 2880]) {
      const rest = at(p, 1, tick).rest;
      if (!rest) throw new Error('no rest');
      expect(restBounds(rest, SPACE).top).toBeGreaterThanOrEqual(
        headSpan(at(p, 0, tick)).bottom + CLEAR,
      );
    }
    expect(restsOnHeads(laid(built))).toEqual([]);
  });

  it('keeps an upper voice rest clear of high lower voice heads', () => {
    const built = piano()
      .bar()
      .rest('4')
      .beat('4', [midi(60)])
      .beat('2', [midi(62)])
      .voice(1)
      .beat('4', [midi(81), midi(84)])
      .beat('4', [midi(55)])
      .beat('2', [midi(55)])
      .build({ ids: 'sequential' });
    const p = plan(built);
    const rest = at(p, 0, 0).rest;
    if (!rest) throw new Error('no rest');
    expect(restBounds(rest, SPACE).bottom).toBeLessThanOrEqual(headSpan(at(p, 1, 0)).top - CLEAR);
    expect(restsOnHeads(laid(built))).toEqual([]);
  });

  it('carries the dots of a moved rest with it', () => {
    const built = piano()
      .bar()
      .beat('2', [midi(64)])
      .beat('2', [midi(71), midi(72)])
      .voice(1)
      .rest('32')
      .rest('4.')
      .beat('2', [midi(52)])
      .build({ ids: 'sequential' });
    const p = plan(built);
    const dotted = p.beats.filter(({ rest, voice }) => rest && voice === 1);
    expect(dotted).toHaveLength(2);
    for (const { rest } of dotted) {
      if (!rest) continue;
      const row = rest.position % 2 === 0 ? rest.position + 1 : rest.position;
      expect(rest.y).toBeCloseTo(positionY(rest.position, SPACE), 6);
      expect(rest.dots.y).toBeCloseTo(positionY(row, SPACE), 6);
    }
    expect(restsOnHeads(laid(built))).toEqual([]);
  });

  it('does not count a voice of rests only as a voice', () => {
    const four = piano()
      .bar()
      .beat('4', [midi(74)])
      .beat('4', [midi(74)])
      .beat('4', [midi(74)])
      .beat('4', [midi(74)])
      .voice(1)
      .rest('1')
      .build({ ids: 'sequential' });
    const p = plan(four);
    expect(p.multiVoice).toBe(false);
    expect(p.layered).toBe(true);
    expect(p.beats.flatMap(({ chord }) => (chord ? [chord.direction] : []))).toEqual(
      Array.from({ length: 4 }, () => 'down'),
    );
    expect(restsOnHeads(laid(four))).toEqual([]);

    const six = piano()
      .timeSignature(6, 8)
      .bar()
      .beat('8', [midi(74)])
      .beat('8', [midi(74)])
      .beat('8', [midi(74)])
      .beat('8', [midi(74)])
      .beat('8', [midi(74)])
      .beat('8', [midi(74)])
      .voice(1)
      .rest('2.')
      .build({ ids: 'sequential' });
    expect(plan(six).multiVoice).toBe(false);
    expect(restsOnHeads(laid(six))).toEqual([]);
  });

  it('draws two whole-bar rests as one', () => {
    const built = piano().bar().rest('1').voice(1).rest('1').build({ ids: 'sequential' });
    const result = laid(built);
    const wholes = result.primitives.filter((p) => p.kind === 'glyph' && p.glyph === 'restWhole');
    expect(wholes).toHaveLength(2);
    expect(wholes[0]?.bbox).toEqual(wholes[1]?.bbox);
    expect(plan(built).beats.map(({ rest }) => rest?.position)).toEqual([6, 6]);
  });

  it('clears the stem tip of an upper chord for a rest of a third voice stemming up', () => {
    const built = piano()
      .bar()
      .beat('4', [midi(64)])
      .rest('4')
      .rest('2')
      .voice(1)
      .beat('1', [midi(48)])
      .voice(2)
      .rest('4')
      .beat('4', [midi(72)])
      .rest('2')
      .build({ ids: 'sequential' });
    const p = plan(built);
    const rest = at(p, 2, 0).rest;
    const chord = at(p, 0, 0).chord;
    if (!rest || !chord) throw new Error('missing');
    expect(restBounds(rest, SPACE).bottom).toBeLessThanOrEqual(chord.top - CLEAR);
    expect(restsOnHeads(laid(built))).toEqual([]);
  });

  it.each(['standard', 'both'] as const)(
    'leaves room for a tuplet over a moved rest, %s',
    (notation) => {
      const built = score()
        .track('piano', { display: { notation, octaveShift: 0 } })
        .bar()
        .beat('2', [midi(47)])
        .beat('2', [midi(47)])
        .voice(1)
        .rest('8t')
        .rest('8t')
        .rest('8t')
        .beat('2', [midi(40)])
        .build({ ids: 'sequential' });
      for (const options of [{}, { mode: 'continuous', width: 640 } as const]) {
        const result = laid(built, options);
        expect(strayPrimitives(result, built)).toEqual([]);
        expect(restsOnHeads(result)).toEqual([]);
      }
    },
  );

  it('clears a drum hit with a rest of the second drum voice', () => {
    const built = score()
      .track('drums')
      .bar()
      .beat('4', [midi(41)])
      .beat('4', [midi(41)])
      .voice(1)
      .rest('4')
      .beat('4', [midi(36)])
      .build({ ids: 'sequential' });
    const p = plan(built, 0, true);
    const rest = at(p, 1, 0).rest;
    if (!rest) throw new Error('no rest');
    const { top, bottom } = restBounds(rest, SPACE);
    const hit = headSpan(at(p, 0, 0));
    expect(top >= hit.bottom + CLEAR || bottom <= hit.top - CLEAR).toBe(true);
  });

  it('re-measures a bar whose second voice turns to rests, as a cold layout does', () => {
    const built = piano()
      .bar()
      .beat('2', [midi(64)])
      .beat('2', [midi(71)])
      .voice(1)
      .beat('2', [midi(52)])
      .beat('2', [midi(55)])
      .build({ ids: 'sequential' });
    const cache = new LayoutCache();
    layout(built, paged, cache);
    let edited = built;
    let touched: readonly string[] = [];
    for (const beat of [0, 1]) {
      const step = applyCommand(
        edited,
        setBeatRest({ beatId: beatOf(edited, 0, 0, beat, 1).id }, true),
      );
      edited = step.score;
      touched = step.change.touchedBars;
      const result = layout(edited, { ...paged, dirtyBars: touched }, cache);
      expect(stable(result)).toBe(stable(layout(edited, paged)));
    }
    expect(plan(edited).multiVoice).toBe(false);
  });
});

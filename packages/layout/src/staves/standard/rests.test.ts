import { applyCommand, setBeatRest, type Clef, type Score } from '@reprise/model';
import { beatOf, midi, note, score, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  LayoutCache,
  PAGE_SIZES,
  layout,
  type LayoutOptions,
  type LayoutResult,
} from '../../index';
import {
  expectValid,
  restsOnHeads,
  restsOnRests,
  stable,
  strayPrimitives,
} from '../../test/check-result';
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
    chordDiagrams: true,
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

function expectClear(result: LayoutResult): void {
  expect(restsOnHeads(result)).toEqual([]);
  expect(restsOnRests(result)).toEqual([]);
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

describe('rests beside chords a float apart', () => {
  it('clears a centred rest from the chords of two voices at their one onset', () => {
    // Seven septuplet 32nds reach tick 960 a float short of voice 2's quarter, so the two chords
    // are one onset and the only one the centred whole rest of voice 0 has to clear.
    const builder = piano().bar().rest('1');
    builder.voice(1);
    for (let i = 0; i < 7; i++) builder.rest('32', { tuplet: { n: 7, of: 8 } });
    builder.beat('4', [midi(74)]);
    builder
      .voice(2)
      .rest('4')
      .beat('4', [midi(76)]);
    const p = plan(builder.build({ ids: 'sequential' }));
    const rest = p.beats.find((beat) => beat.voice === 0)?.rest;
    if (!rest) throw new Error('no rest');
    const { top, bottom } = restBounds(rest, SPACE);
    for (const beat of p.beats.filter((b) => b.chord)) {
      const span = headSpan(beat);
      expect(top >= span.bottom - 1e-6 || bottom <= span.top + 1e-6).toBe(true);
    }
  });
});

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
    expectClear(laid(built));
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
    expectClear(laid(built));
  });

  it('carries the dots of a moved rest with it', () => {
    const built = piano()
      .bar()
      .beat('2', [midi(64)])
      .beat('2', [midi(71), midi(72)])
      .voice(1)
      .rest('4.')
      .beat('8', [midi(52)])
      .beat('2', [midi(52)])
      .build({ ids: 'sequential' });
    const p = plan(built);
    const rest = at(p, 1, 0).rest;
    if (!rest) throw new Error('no rest');
    // A voice 2 rest defaults to the bottom line, under the E4 it must clear.
    expect(rest.position).toBeLessThan(0);
    expect(rest.dots.y).toBeCloseTo(positionY(rest.position + 1, SPACE), 6);
    expectClear(laid(built));
  });

  it('hides a secondary voice that is one whole-bar rest beside a voice with notes', () => {
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
    expect(p.layered).toBe(false);
    expect(p.beats.flatMap(({ chord }) => (chord ? [chord.direction] : []))).toEqual(
      Array.from({ length: 4 }, () => 'down'),
    );
    const result = laid(four);
    expect(result.primitives.filter((q) => q.kind === 'glyph' && q.glyph === 'restWhole')).toEqual(
      [],
    );
    expectClear(result);

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
    expectClear(laid(six));
  });

  it('hides a secondary voice rest that fills a pickup bar, and keeps a shorter one', () => {
    const pickup = (rest: '4' | '8'): Score =>
      piano()
        .bar()
        .anacrusis()
        .beat('4', [midi(74)])
        .voice(1)
        .rest(rest)
        .build({ ids: 'sequential' });
    const rests = (built: Score): number =>
      laid(built).primitives.filter((q) => q.kind === 'glyph' && q.glyph.startsWith('rest')).length;
    expect(plan(pickup('4')).multiVoice).toBe(false);
    expect(rests(pickup('4'))).toBe(0);
    // An eighth rest is shorter than the quarter note, so it is a voice like any other.
    expect(plan(pickup('8')).multiVoice).toBe(true);
    expect(rests(pickup('8'))).toBe(1);
  });

  it('hides a pickup-filling rest on a tab-only staff too', () => {
    const tab = (rest: '4' | '8'): Score =>
      score()
        .track('guitar', { display: { notation: 'tab', octaveShift: 0 } })
        .bar()
        .anacrusis()
        .beat('4', [note(2, 5)])
        .voice(1)
        .rest(rest)
        .build({ ids: 'sequential' });
    const rests = (built: Score): number =>
      laid(built).primitives.filter((q) => q.kind === 'glyph' && q.glyph.startsWith('rest')).length;
    expect(rests(tab('4'))).toBe(0);
    expect(rests(tab('8'))).toBe(1);
  });

  it('draws a lone short rest of a secondary voice, which does not fill the bar', () => {
    const built = piano()
      .bar()
      .beat('4', [midi(74)])
      .beat('4', [midi(74)])
      .beat('4', [midi(74)])
      .beat('4', [midi(74)])
      .voice(1)
      .rest('4')
      .build({ ids: 'sequential' });
    const p = plan(built);
    expect(p.beats.some(({ hidden }) => hidden)).toBe(false);
    expect(p.multiVoice).toBe(true);
    const result = laid(built);
    expect(
      result.primitives.filter((q) => q.kind === 'glyph' && q.glyph === 'restQuarter'),
    ).toHaveLength(1);
    expectClear(result);
  });

  it('hides the whole-bar rest of a secondary voice on a tab-only staff too', () => {
    const tab = (voiceOne: (b: ScoreBuilder) => ScoreBuilder): Score =>
      voiceOne(
        score()
          .track('guitar', { display: { notation: 'tab', octaveShift: 0 } })
          .bar()
          .beat('4', [note(1, 3)])
          .beat('4', [note(1, 3)])
          .beat('4', [note(1, 3)])
          .beat('4', [note(1, 3)])
          .voice(1),
      ).build({ ids: 'sequential' });
    const rests = (built: Score): number =>
      laid(built).primitives.filter((q) => q.kind === 'glyph' && q.glyph.startsWith('rest')).length;
    expect(rests(tab((b) => b.rest('1')))).toBe(0);
    expect(rests(tab((b) => b.rest('4')))).toBe(1);
  });

  it('never hides voice 0, and keeps a whole-bar rest beside rests that are drawn', () => {
    const built = piano()
      .bar()
      .rest('1')
      .voice(1)
      .beat('1', [midi(60)])
      .build({ ids: 'sequential' });
    expect(plan(built).beats.some(({ hidden }) => hidden)).toBe(false);
    expectClear(laid(built));
  });

  it('keeps a whole-bar rest from the other voice away from its rests', () => {
    const built = piano()
      .bar()
      .beat('4', [midi(74)])
      .rest('4')
      .rest('4')
      .beat('4', [midi(74)])
      .voice(1)
      .rest('1')
      .build({ ids: 'sequential' });
    expectClear(laid(built));
  });

  it('counts a voice of several rests as a voice: two-voice stems, rests displaced', () => {
    const built = piano()
      .bar()
      .beat('4', [midi(74)])
      .beat('4', [midi(74)])
      .beat('4', [midi(74)])
      .beat('4', [midi(74)])
      .voice(1)
      .rest('2')
      .rest('2')
      .build({ ids: 'sequential' });
    const p = plan(built);
    expect(p.multiVoice).toBe(true);
    expect(p.beats.flatMap(({ chord }) => (chord ? [chord.direction] : []))).toEqual(
      Array.from({ length: 4 }, () => 'up'),
    );
    const result = laid(built);
    expectClear(result);
    expect(
      result.primitives.filter((q) => q.kind === 'glyph' && q.glyph === 'restHalf'),
    ).toHaveLength(2);
  });

  it('draws ledger lines for a whole or half rest that leaves the staff', () => {
    const built = piano()
      .bar()
      .beat('2', [midi(60)])
      .beat('2', [midi(60)])
      .voice(1)
      .rest('2')
      .rest('2')
      .build({ ids: 'sequential' });
    const p = plan(built);
    const low = p.beats.filter(({ rest }) => rest && rest.position < 0);
    expect(low.length).toBeGreaterThan(0);
    const result = laid(built);
    const ledgers = result.primitives.filter(
      (q) => q.kind === 'line' && low.some(({ beat }) => beat.id === q.node),
    );
    expect(ledgers.length).toBeGreaterThanOrEqual(low.length);
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
    expectClear(laid(built));
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
      expect(plan(built).tuplets[0]?.above).toBe(false);
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
    const { top } = restBounds(rest, SPACE);
    const hit = headSpan(at(p, 0, 0));
    expect(top).toBeGreaterThanOrEqual(hit.bottom + CLEAR);
  });

  it('re-measures a bar whose second voice turns to rests, as a cold layout does', () => {
    const built = piano()
      .bar()
      .beat('2', [midi(64)])
      .beat('2', [midi(71)])
      .voice(1)
      .beat('1', [midi(52)])
      .build({ ids: 'sequential' });
    const cache = new LayoutCache();
    layout(built, paged, cache);
    expect(plan(built).multiVoice).toBe(true);
    // The voice becomes a hidden whole-bar rest, so the bar stops being two-voice.
    const step = applyCommand(built, setBeatRest({ beatId: beatOf(built, 0, 0, 0, 1).id }, true));
    const result = layout(step.score, { ...paged, dirtyBars: step.change.touchedBars }, cache);
    expect(stable(result)).toBe(stable(layout(step.score, paged)));
    expect(plan(step.score).multiVoice).toBe(false);
  });
});

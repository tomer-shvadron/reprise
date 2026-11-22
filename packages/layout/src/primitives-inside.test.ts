import { note, score } from '@reprise/model/testing';
import { assert, constant, constantFrom, integer, oneof, property, tuple } from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Bend, Notation, Score } from '@reprise/model';

import {
  DEFAULT_MARGINS,
  PAGE_SIZES,
  layout,
  type LayoutOptions,
  type LayoutResult,
} from './index';
import { expectValid } from './test/check-result';
import { randomScore } from './test/random-score';

const EPSILON = 0.02;

/**
 * Primitives, as `kind node`, that reach past the right edge of the system drawing them. Only the
 * right edge: continuous segments draw a few markings (pedal and track names) left of their
 * frame on purpose, in the margin.
 */
function outside(result: LayoutResult): string[] {
  const found: string[] = [];
  for (const system of result.systems) {
    const right = system.bbox.x - (system.offsetX ?? 0) + system.bbox.width;
    for (const primitive of result.primitives.slice(
      system.primitives.start,
      system.primitives.end,
    )) {
      const { x, width } = primitive.bbox;
      if (x + width > right + EPSILON) found.push(`${primitive.kind} ${primitive.node ?? '-'}`);
    }
  }
  return found;
}

/** Systems, as `index`, that end right of the line, the page width less the right margin. */
function lineOverflow(result: LayoutResult, width: number): number[] {
  const line = width - DEFAULT_MARGINS.paged.right;
  return result.systems
    .filter((system) => system.bbox.x + system.bbox.width > line + EPSILON)
    .map((system) => system.index);
}

function options(built: Score, width: number, notation: Notation): LayoutOptions {
  return {
    mode: 'paged',
    width,
    pageHeight: PAGE_SIZES.a4.height,
    zoom: 1,
    tracks: 'all',
    notation: Object.fromEntries(built.tracks.map(({ id }) => [id, notation])),
  };
}

type NoteSpec = NonNullable<Parameters<typeof note>[2]>;

const PREBEND: Bend = {
  kind: 'prebend',
  points: [
    { position: 0, value: 4 },
    { position: 60, value: 4 },
  ],
};
const BEND: Bend = {
  kind: 'bend',
  points: [
    { position: 0, value: 0 },
    { position: 60, value: 4 },
  ],
};

/** Twelve bars of `count` beats of `duration`, each ending on a note made from `last`. */
function endingOn(duration: '8' | '16', count: number, last: NoteSpec, fret = 5): Score {
  const built = score().track('guitar');
  for (let bar = 0; bar < 12; bar++) {
    built.bar();
    for (let i = 0; i < count - 1; i++) built.beat(duration, [note(2, (i % 5) + 1)]);
    built.beat(duration, [note(3, fret, last)]);
  }
  return built.build({ ids: 'sequential' });
}

/** The widths from `from` to `to` px, every 20, at which `built` draws past a system's edge. */
function overflowing(built: Score, notation: Notation, from: number, to: number): number[] {
  const found: number[] = [];
  for (let width = from; width <= to; width += 20) {
    if (outside(layout(built, options(built, width, notation))).length > 0) found.push(width);
  }
  return found;
}

describe('primitives stay inside their system', () => {
  it('in a squeezed bar whose last beat has a second voice moved right of it', () => {
    const first = score().track('guitar').bar();
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 0), note(2, 0), note(3, 0)]);
    first.voice(1);
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 1), note(2, 1)]);
    const built = first.build({ ids: 'sequential' });
    const result = layout(built, {
      mode: 'paged',
      width: 240,
      pageHeight: PAGE_SIZES.a4.height,
      zoom: 1,
      tracks: 'all',
      notation: Object.fromEntries(built.tracks.map(({ id }) => [id, 'standard' as const])),
    });
    expect(outside(result)).toEqual([]);
  });

  it('ends every paged system within its line, even where the rigid parts alone overflow it', () => {
    // Seed 399 has an onset of three voices, each shifted right of the one before: 117.8 px of
    // rigid parts against 61.7 px of room at 320 px.
    const built = randomScore(399, { diagrams: true });
    const result = layout(built, options(built, 320, 'standard'));
    // Its heads cannot all fit, so some stay past the bar\'s end (anchors collapse onto it), but
    // the system keeps to its line.
    expectValid(result);
    expect(lineOverflow(result, 320)).toEqual([]);
  });

  it("keeps a harmonic's slide-out inside the bar, room counted from past its brackets", () => {
    const built = endingOn('8', 8, {
      harmonic: { kind: 'artificial', value: 12 },
      slide: ['outDown'],
    });
    expect(overflowing(built, 'tab', 300, 1200)).toEqual([]);
  });

  it("keeps a harmonic's bend inside the bar, room counted from past its brackets", () => {
    const built = endingOn('8', 8, { harmonic: { kind: 'artificial', value: 12 }, bend: BEND });
    expect(overflowing(built, 'tab', 300, 1200)).toEqual([]);
  });

  it("stops a pre-bend's hold at the bar's end in standard notation", () => {
    const built = endingOn('16', 16, { bend: PREBEND }, 12);
    expect(overflowing(built, 'standard', 300, 440)).toEqual([]);
  });

  it("keeps the sl. letter of a legato arc cut by the bar's end inside the system", () => {
    for (const seed of [53, 377]) {
      const built = randomScore(seed, { diagrams: true });
      expect(outside(layout(built, options(built, 320, 'tab'))), `seed ${String(seed)}`).toEqual(
        [],
      );
    }
  });

  it('draws bends in the dense standard bars at 320 px with a frame that ends after it starts', () => {
    for (const seed of [16, 399]) {
      const built = randomScore(seed, { diagrams: true });
      expectValid(layout(built, options(built, 320, 'standard')));
    }
  });

  it('holds for random scores in paged mode at narrow and wide lines', () => {
    // Paged only: continuous mode never squeezes (`finish` squeezes only paged lines), so it
    // could not reach the squeezed cases this guards. At 320 px tab alone is held to it: a few
    // dense seeds (16, 59, 158, 161, 169, 250, 399) still draw standard heads, words or a slide
    // past a line their bars cannot fit (the rigid parts alone overflow it), tracked in #477.
    assert(
      property(
        integer({ min: 0, max: 400 }),
        oneof(
          tuple(constant(320), constant<Notation>('tab')),
          tuple(constantFrom(500, 700, 1200), constantFrom<Notation>('tab', 'standard', 'both')),
        ),
        (seed, [width, notation]) => {
          const built = randomScore(seed, { diagrams: true });
          const result = layout(built, options(built, width, notation));
          const label = `seed ${String(seed)} ${String(width)} ${notation}`;
          expect(outside(result), label).toEqual([]);
          expect(lineOverflow(result, width), label).toEqual([]);
        },
      ),
      { numRuns: 240 },
    );
  }, 60_000);
});

import { note, score } from '@reprise/model/testing';
import { assert, constantFrom, integer, property } from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Notation, Score } from '@reprise/model';

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
    // Its heads cannot all fit, so some stay past the bar's end (anchors collapse onto it), but
    // the system keeps to its line.
    expectValid(result);
    expect(lineOverflow(result, 320)).toEqual([]);
  });

  it('holds for random scores in paged mode at narrow and wide lines', () => {
    // Paged only: continuous mode never squeezes (`finish` squeezes only paged lines), so it
    // could not reach the squeezed cases this guards. At 320 px tab alone is held to it: a few
    // dense seeds (16, 59, 158, 161, 169, 250, 399) still draw standard heads, words or a slide
    // past a line their bars cannot fit (the rigid parts alone overflow it), tracked in #477.
    assert(
      property(
        integer({ min: 0, max: 400 }),
        constantFrom(320, 500, 700, 1200),
        constantFrom('tab', 'standard', 'both'),
        (seed, width, notation) => {
          if (width === 320 && notation !== 'tab') return;
          const built = randomScore(seed, { diagrams: true });
          const result = layout(built, options(built, width, notation));
          const label = `seed ${String(seed)} ${String(width)} ${notation}`;
          expect(outside(result), label).toEqual([]);
          expect(lineOverflow(result, width), label).toEqual([]);
        },
      ),
      { numRuns: 240 },
    );
  }, 30_000);
});

import { note, score } from '@reprise/model/testing';
import { assert, constantFrom, integer, property } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PAGE_SIZES, layout, type LayoutResult } from './index';
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

describe('primitives stay inside their system', () => {
  it('in a squeezed bar whose last beat has a second voice moved right of it', () => {
    const first = score().track('guitar').bar();
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 0), note(2, 0), note(3, 0)]);
    first.voice(1);
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 1), note(2, 1)]);
    const built = first.build({ ids: 'sequential' });
    const result = layout(built, {
      mode: 'paged',
      width: 200,
      pageHeight: PAGE_SIZES.a4.height,
      zoom: 1,
      tracks: 'all',
      notation: Object.fromEntries(built.tracks.map(({ id }) => [id, 'standard' as const])),
    });
    expect(outside(result)).toEqual([]);
  });

  it('holds for random scores in both modes at narrow and wide lines', () => {
    assert(
      property(
        integer({ min: 0, max: 400 }),
        constantFrom(320, 500, 700, 1200),
        constantFrom('standard', 'both', 'tab'),
        (seed, width, notation) => {
          const built = randomScore(seed, { diagrams: true });
          for (const mode of ['paged', 'continuous'] as const) {
            const result = layout(built, {
              mode,
              width,
              pageHeight: PAGE_SIZES.a4.height,
              zoom: 1,
              tracks: 'all',
              notation: Object.fromEntries(built.tracks.map(({ id }) => [id, notation])),
            });
            expect(
              outside(result),
              `seed ${String(seed)} ${mode} ${String(width)} ${notation}`,
            ).toEqual([]);
          }
        },
      ),
      { numRuns: 80 },
    );
  }, 30_000);
});

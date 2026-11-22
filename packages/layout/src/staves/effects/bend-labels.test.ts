import { parseNative, type Bend, type Notation, type Score } from '@reprise/model';
import { note } from '@reprise/model/testing';
import { describe, expect, inject, it } from 'vitest';

import { LayoutCache, layout, type LayoutResult, type Primitive } from '../../index';
import { stable, strayPrimitives } from '../../test/check-result';
import { guitar, laid, paged } from '../../test/effects';
import { bendLabel } from './labels';

declare const TextEncoder: new () => { encode(input: string): Uint8Array };
declare module 'vitest' {
  export interface ProvidedContext {
    scoreFixtures: { path: string; native: string }[];
  }
}

const modes = ['tab', 'standard', 'both'] as const;
type Mode = (typeof modes)[number];

const custom = (points: [number, number][]): Bend => ({
  kind: 'custom',
  points: points.map(([position, value]) => ({ position, value })),
});

const LABELS = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(bendLabel));
const box = (p: Primitive) => p.bbox;
const hit = (a: Primitive['bbox'], b: Primitive['bbox']) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const isLabel = (p: Primitive) =>
  p.kind === 'text' && LABELS.has(p.text) && p.node?.startsWith('note') === true;
const isArrowhead = (p: Primitive) => p.kind === 'path' && p.fill && p.d.split('L').length === 3;

/** Pairs of bend labels, and with `withArrowheads` labels over arrowheads, that overlap. */
function collisions(result: LayoutResult, withArrowheads = true): string[] {
  const labels = result.primitives.filter(isLabel);
  // The zigzag's tips are a few positions apart, so its arrowheads cannot all clear its labels.
  const heads = withArrowheads ? result.primitives.filter(isArrowhead) : [];
  const found: string[] = [];
  for (const [i, a] of labels.entries()) {
    for (const b of labels.slice(i + 1)) {
      if (hit(box(a), box(b))) {
        found.push(`${a.kind === 'text' ? a.text : ''} on ${b.kind === 'text' ? b.text : ''}`);
      }
    }
    for (const head of heads) {
      if (hit(box(a), box(head))) found.push(`${a.kind === 'text' ? a.text : ''} on arrowhead`);
    }
  }
  return found;
}

const single = (mode: Mode, duration: '1' | '2' | '4' | '8' | '16', bend: Bend) => {
  const builder = guitar(mode)
    .bar()
    .beat(duration, [note(2, 12, { bend })]);
  const rests: Record<string, string[]> = {
    '1': [],
    '2': ['2'],
    '4': ['2.'],
    '8': ['4.', '2'],
    '16': ['8.', '2'],
  };
  for (const rest of rests[duration] ?? []) builder.rest(rest as '2');
  return builder.build({ ids: 'sequential' });
};

const SHAPES: Record<string, Bend> = {
  'full then 1¼ at 20 and 40': custom([
    [0, 0],
    [20, 4],
    [40, 5],
    [60, 5],
  ]),
  'full then 1¼ at 30 and 60': custom([
    [0, 0],
    [30, 4],
    [60, 5],
  ]),
  '½ then ¾ at 20 and 40': custom([
    [0, 0],
    [20, 2],
    [40, 3],
    [60, 3],
  ]),
  '¼ ½ ¾ full': custom([
    [0, 0],
    [15, 1],
    [30, 2],
    [45, 3],
    [60, 4],
  ]),
};
const ZIGZAG = custom([
  [0, 0],
  [15, 0],
  [18, 4],
  [20, 4],
  [23, 2],
  [25, 2],
  [28, 6],
  [42, 6],
  [47, 7],
  [49, 5],
  [52, 7],
  [54, 5],
  [57, 7],
  [60, 6],
]);

describe('one note keeps its distinct bend labels apart (#162, #323)', () => {
  const cases = Object.entries(SHAPES).flatMap(([name, bend]) =>
    (['4', '8', '16'] as const).flatMap((d) => modes.map((m) => [name, d, m, bend] as const)),
  );
  it.each(cases)('%s, 1/%s note, %s', (_name, duration, mode, bend) => {
    const result = laid(single(mode, duration, bend));
    expect(collisions(result)).toEqual([]);
  });

  it.each(modes)('a whole note ending in a zigzag clears its labels at A4 in %s', (mode) => {
    expect(collisions(laid(single(mode, '1', ZIGZAG)), false)).toEqual([]);
  });

  it.each([480, 640])('the zigzag clears its labels at %s px', (width) => {
    for (const mode of modes) {
      const built = single(mode, '1', ZIGZAG);
      expect(collisions(laid(built, { width }), false)).toEqual([]);
    }
  });

  it.each(modes)('measures the lane for the stack so nothing strays in %s', (mode) => {
    const built = single(mode, '16', SHAPES['full then 1¼ at 20 and 40'] ?? ZIGZAG);
    expect(strayPrimitives(laid(built), built)).toEqual([]);
  });

  it('lays a quarter-tone pair out the same cached as cold', () => {
    const built = single('both', '16', SHAPES['½ then ¾ at 20 and 40'] ?? ZIGZAG);
    const cache = new LayoutCache();
    layout(built, paged, cache);
    expect(stable(layout(built, paged, cache))).toBe(stable(layout(built, paged)));
  });
});

describe('bend labels over the fixtures (#323)', () => {
  const fixtures = inject('scoreFixtures');
  const read = (native: string): Score => parseNative(new TextEncoder().encode(native)).score;
  const widths = [paged.width, 480, 320];

  it('overlap nowhere in tab, standard and both at A4, 480 and 320 px', () => {
    const found: string[] = [];
    for (const { path, native } of fixtures) {
      const built = read(native);
      for (const mode of modes) {
        const notation: Notation = mode;
        for (const width of widths) {
          const result = layout(built, {
            ...paged,
            width,
            notation: Object.fromEntries(
              built.tracks.map((track) => [
                track.id,
                track.kind === 'pitched' ? track.display.notation : notation,
              ]),
            ),
          });
          const labels = collisions(result, false);
          if (labels.length > 0)
            found.push(`${path} ${mode} ${String(width)}: ${labels.join(', ')}`);
        }
      }
    }
    expect(found).toEqual([]);
  }, 120_000);
});

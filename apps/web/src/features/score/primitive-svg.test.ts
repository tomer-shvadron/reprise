import { LayoutCache, layout, PAGE_SIZES, type Primitive } from '@reprise/layout';
import { applyCommand, setNote } from '@reprise/model';
import { beatOf, fullScore, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { primitiveToSvg, samePrimitives } from './primitive-svg';

const bbox = { x: 0, y: 0, width: 1, height: 1 };
const options = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
} as const;

describe('primitiveToSvg', () => {
  it('draws a glyph as text with its codepoint in Bravura', () => {
    const glyph: Primitive = {
      kind: 'glyph',
      glyph: 'gClef',
      codepoint: 57424,
      size: 28,
      x: 10,
      y: 20,
      bbox,
      role: 'ink',
    };
    expect(primitiveToSvg(glyph)).toEqual({
      tag: 'text',
      text: '\u{E050}',
      props: { x: 10, y: 20, fontSize: 28, fill: 'currentColor', className: 'score-glyph' },
    });
  });

  it('draws text with its anchor, italics and role', () => {
    const base = { kind: 'text', text: '12', size: 9, x: 1, y: 2, bbox, italic: false } as const;
    expect(primitiveToSvg({ ...base, anchor: 'start', role: 'ink' }).props).toEqual({
      x: 1,
      y: 2,
      fontSize: 9,
      fill: 'currentColor',
      className: 'score-text',
    });
    expect(
      primitiveToSvg({ ...base, anchor: 'middle', italic: true, role: 'muted' }).props,
    ).toMatchObject({
      textAnchor: 'middle',
      className: 'score-text score-italic score-role-muted',
    });
    expect(primitiveToSvg({ ...base, anchor: 'end', role: 'accent' }).props).toMatchObject({
      textAnchor: 'end',
      className: 'score-text score-role-accent',
    });
  });

  it('draws a line, dashed when asked', () => {
    const line = { kind: 'line', x: 1, y: 2, x2: 3, y2: 4, thickness: 0.5, bbox } as const;
    expect(primitiveToSvg({ ...line, role: 'ink' })).toEqual({
      tag: 'line',
      props: { x1: 1, y1: 2, x2: 3, y2: 4, stroke: 'currentColor', strokeWidth: 0.5 },
    });
    expect(primitiveToSvg({ ...line, dash: [2, 3], role: 'accent' }).props).toMatchObject({
      strokeDasharray: '2 3',
      className: 'score-role-accent',
    });
  });

  it('fills or strokes a path', () => {
    const path = { kind: 'path', d: 'M0 0L1 1', x: 0, y: 0, bbox } as const;
    expect(primitiveToSvg({ ...path, fill: true, thickness: 0, role: 'paper' })).toEqual({
      tag: 'path',
      props: { d: 'M0 0L1 1', fill: 'currentColor', className: 'score-role-paper' },
    });
    expect(primitiveToSvg({ ...path, fill: true, thickness: 1, role: 'ink' }).props).toEqual({
      d: 'M0 0L1 1',
      fill: 'currentColor',
      stroke: 'currentColor',
      strokeWidth: 1,
    });
    expect(primitiveToSvg({ ...path, fill: false, thickness: 2, role: 'ink' }).props).toEqual({
      d: 'M0 0L1 1',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
    });
  });

  it('paints every primitive of a real layout with currentColor or none', () => {
    for (const primitive of layout(fullScore(), options).primitives) {
      const { props } = primitiveToSvg(primitive);
      for (const key of ['fill', 'stroke'] as const) {
        const value: unknown = Reflect.get(props, key);
        if (value !== undefined) expect(['currentColor', 'none']).toContain(value);
      }
    }
  });
});

describe('samePrimitives', () => {
  const { primitives } = layout(fullScore(), options);
  const range = { start: 3, end: 10 };

  it('holds for the same objects, at the same or shifted indices', () => {
    expect(samePrimitives(primitives, range, primitives, range)).toBe(true);
    const shifted = [primitives[0], primitives[0], ...primitives].filter(
      (p): p is Primitive => p !== undefined,
    );
    expect(samePrimitives(primitives, range, shifted, { start: 5, end: 12 })).toBe(true);
  });

  it('holds for equal copies and fails on a changed value or length', () => {
    const copy = primitives.map((p) => ({ ...p, bbox: { ...p.bbox } }));
    expect(samePrimitives(primitives, range, copy, range)).toBe(true);
    const moved = copy.map((p, i) =>
      i === 5 ? { ...p, bbox: { ...p.bbox, x: p.bbox.x + 1 } } : p,
    );
    expect(samePrimitives(primitives, range, moved, range)).toBe(false);
    expect(samePrimitives(primitives, range, primitives, { start: 3, end: 9 })).toBe(false);
  });

  it('holds for every system after an edit but the edited one', () => {
    const score = largeScore(2, 24, { structure: true });
    const cache = new LayoutCache();
    const before = layout(score, options, cache);
    const { score: next, change } = applyCommand(
      score,
      setNote({ beatId: beatOf(score, 0, 10, 0).id }, { string: 1, fret: 9 }),
    );
    const after = layout(next, { ...options, dirtyBars: change.touchedBars }, cache);
    // The systems within three bars of bar 10 are rebuilt, as equal objects but the edited one.
    const rebuilt = after.systems.length - after.metrics.reusedSystems;
    expect(rebuilt).toBeGreaterThanOrEqual(2);
    expect(rebuilt).toBeLessThanOrEqual(3);
    const edited = after.systems.find((s) => s.bars.start <= 10 && 10 < s.bars.end);
    for (const [i, b] of after.systems.entries()) {
      const a = before.systems[i];
      if (!a) throw new Error(`system ${String(i)} missing`);
      expect(samePrimitives(before.primitives, a.primitives, after.primitives, b.primitives)).toBe(
        b !== edited,
      );
    }
    const old = before.systems.find((s) => s.id === edited?.id);
    if (!edited || !old) throw new Error('edited system missing');
    expect(
      samePrimitives(before.primitives, old.primitives, after.primitives, edited.primitives),
    ).toBe(false);
  });
});

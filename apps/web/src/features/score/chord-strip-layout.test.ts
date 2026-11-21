import { describe, expect, it } from 'vitest';

import { PRINT_STRIP, stripLayout } from './chord-strip-layout';

const diagram = { baseFret: 1, frets: [0, 1, 2, 2, 0, null] };
const entry = (name: string, suggested = false, shaped = true) => ({
  name,
  suggested,
  ...(shaped && { diagram }),
});

const texts = (strip: ReturnType<typeof stripLayout>) =>
  strip?.primitives.flatMap((p) => (p.kind === 'text' ? [p] : [])) ?? [];

describe('stripLayout', () => {
  it('has nothing to draw without chords', () => {
    expect(stripLayout([], 700)).toBeUndefined();
  });

  it('puts a name over each diagram, left to right in the given order', () => {
    const strip = stripLayout([entry('Am'), entry('G'), entry('C')], 700);
    const names = texts(strip).filter((p) => p.size === PRINT_STRIP.nameSize);
    expect(names.map((p) => p.text)).toEqual(['Am', 'G', 'C']);
    const xs = names.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(strip?.height).toBeGreaterThan(PRINT_STRIP.nameLine);
    // One row: the diagrams all start below the names.
    expect(new Set(names.map((p) => p.y)).size).toBe(1);
  });

  it('mutes a suggested shape and its name, and keeps a file shape in ink', () => {
    const strip = stripLayout([entry('Am', true), entry('G', false)], 700);
    const roles = (name: string) =>
      strip?.primitives.filter((p) => p.kind === 'text' && p.text === name).map((p) => p.role);
    expect(roles('Am')).toEqual(['muted']);
    expect(roles('G')).toEqual(['ink']);
    expect(strip?.primitives.some((p) => p.kind === 'path' && p.role === 'muted')).toBe(true);
    expect(strip?.primitives.some((p) => p.kind === 'path' && p.role === 'ink')).toBe(true);
  });

  it('wraps to a new row when the width runs out, and every cell stays inside it', () => {
    const many = Array.from({ length: 12 }, (_, i) => entry(`C${String(i)}`));
    const narrow = stripLayout(many, 200);
    const wide = stripLayout(many, 2000);
    expect(narrow?.height).toBeGreaterThan(wide?.height ?? 0);
    for (const p of narrow?.primitives ?? []) {
      expect(p.bbox.x + p.bbox.width).toBeLessThanOrEqual(200 + 1);
      expect(p.bbox.x).toBeGreaterThanOrEqual(-1);
    }
  });

  it('keeps to its row limit and counts what it left out', () => {
    const many = Array.from({ length: 80 }, (_, i) => entry(`Chord${String(i)}`));
    const strip = stripLayout(many, 300);
    const rows = new Set(
      strip?.primitives
        .filter((p) => p.kind === 'text' && p.size === PRINT_STRIP.nameSize)
        .map((p) => p.y),
    );
    expect(rows.size).toBe(PRINT_STRIP.maxRows);
    const more = strip?.primitives.find((p) => p.kind === 'text' && /more$/.test(p.text));
    expect(more).toBeDefined();
    for (const p of strip?.primitives ?? []) {
      expect(p.bbox.x + p.bbox.width).toBeLessThanOrEqual(300 + 1);
    }
  });

  it('draws a name with no shape as the name alone', () => {
    const strip = stripLayout([entry('Zzz', false, false)], 700);
    expect(strip?.primitives).toHaveLength(1);
    expect(strip?.height).toBe(PRINT_STRIP.nameLine);
  });
});

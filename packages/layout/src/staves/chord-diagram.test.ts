import type { ChordDiagram } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import type { PathPrimitive, Primitive } from '../types';
import { DIAGRAM, chordDiagramPrimitives, chordDiagramSize } from './chord-diagram';

const SPACE = 10;
const at = { x: 100, y: 50, space: SPACE, node: 'beat-1' };

const diagram = (frets: (number | null)[], rest: Partial<ChordDiagram> = {}): ChordDiagram => ({
  baseFret: 1,
  frets,
  ...rest,
});

const draw = (d: ChordDiagram): Primitive[] => chordDiagramPrimitives(d, at);
const paths = (list: Primitive[]): PathPrimitive[] =>
  list.flatMap((p) => (p.kind === 'path' ? [p] : []));
const texts = (list: Primitive[]) => list.flatMap((p) => (p.kind === 'text' ? [p.text] : []));
/** Sub-paths of a path's data: one per `M`. */
const marks = (p: PathPrimitive | undefined): number => (p?.d.match(/M/g) ?? []).length;

// Strings 1 to 6, as Guitar Pro stores them: the high e first.
const OPEN_C = [0, 1, 0, 2, 3, null];
const F_BARRE = [1, 1, 2, 3, 3, 1];

describe('chordDiagramPrimitives', () => {
  it('draws the grid as one path that carries the diagram box and its lane', () => {
    const list = draw(diagram(OPEN_C));
    const [grid] = paths(list);
    const size = chordDiagramSize(diagram(OPEN_C), SPACE);
    expect(grid?.lane).toBe('chordDiagram');
    expect(grid?.fill).toBe(false);
    expect(grid?.bbox).toEqual({ x: 100, y: 50, ...size });
    expect(list.every((p) => p.node === 'beat-1')).toBe(true);
  });

  it('puts the strings low to high from left to right and a nut at fret 1', () => {
    const list = draw(diagram(OPEN_C));
    const nut = list.find((p) => p.kind === 'line');
    expect(nut?.kind === 'line' && nut.thickness).toBeGreaterThan(
      (paths(list)[0]?.thickness ?? 0) * (DIAGRAM.nut - 0.01),
    );
    expect(texts(list)).toEqual([]);
    // Six strings and five fret lines below the nut.
    expect(marks(paths(list)[0])).toBe(6 + 5);
  });

  it('counts the open, muted and fretted marks of open C', () => {
    const list = draw(diagram(OPEN_C));
    const [grid, dots, ...strokes] = paths(list);
    expect(grid?.lane).toBe('chordDiagram');
    // Three fretted strings and no barre: three circles, each an M.
    expect(dots?.fill).toBe(true);
    expect(marks(dots)).toBe(3);
    const [open, muted] = strokes;
    expect(marks(open)).toBe(2);
    expect(marks(muted)).toBe(2);
  });

  it('draws a barre as one rounded bar and leaves the dots under it out', () => {
    const list = draw(diagram(F_BARRE, { barres: [{ fret: 1, firstString: 1, lastString: 6 }] }));
    const fill = paths(list).find((p) => p.fill);
    // The bar plus the dots on frets 2 and 3: strings 3, 4 and 5.
    expect(marks(fill)).toBe(1 + 3);
    expect(fill?.d).toContain('a');
  });

  it('draws two barres in the same fill path', () => {
    const list = draw(
      diagram([1, 1, 3, 3, 1, 1], {
        barres: [
          { fret: 1, firstString: 1, lastString: 2 },
          { fret: 1, firstString: 5, lastString: 6 },
          { fret: 3, firstString: 3, lastString: 4 },
        ],
      }),
    );
    expect(paths(list).filter((p) => p.fill)).toHaveLength(1);
    expect(marks(paths(list).find((p) => p.fill))).toBe(3);
  });

  it('labels the first fret when the grid starts above fret 1', () => {
    const list = draw(diagram([5, 7, 7, 6, 5, 5], { baseFret: 5 }));
    expect(texts(list)).toEqual(['5fr']);
    expect(list.some((p) => p.kind === 'line')).toBe(false);
  });

  it('starts at the lowest fretted string when it is below baseFret', () => {
    const list = draw(diagram([3, 5, 5, 4, 3, 3], { baseFret: 5 }));
    expect(texts(list)).toEqual(['3fr']);
  });

  it('starts at the lowest fretted string when baseFret 1 hides a high shape', () => {
    expect(texts(draw(diagram([7, 9, 9, 8, 7, 7])))).toEqual(['7fr']);
    expect(texts(draw(diagram([1, 2, 3, 4, 4, 1])))).toEqual([]);
    expect(texts(draw(diagram([1, 2, 3, 6, 6, 1])))).toEqual([]);
  });

  it('shows at least five fret rows, grows for a wider span and stops at six', () => {
    const short = chordDiagramSize(diagram([0, 1, 0, 2, 3, null]), SPACE);
    const six = chordDiagramSize(diagram([5, 6, 7, 8, 10, null], { baseFret: 5 }), SPACE);
    const damaged = chordDiagramSize(diagram([1, null, null, null, null, 15]), SPACE);
    expect(short.height).toBe((DIAGRAM.markRow + DIAGRAM.minRows * DIAGRAM.fretGap) * SPACE);
    expect(six.height).toBe((DIAGRAM.markRow + 6 * DIAGRAM.fretGap) * SPACE);
    expect(damaged.height).toBe((DIAGRAM.markRow + DIAGRAM.maxRows * DIAGRAM.fretGap) * SPACE);
  });

  it('drops the marks past the last row of a damaged diagram', () => {
    const list = draw(diagram([1, null, null, null, null, 15]));
    const fill = paths(list).find((p) => p.fill);
    // Only the dot on fret 1 is inside the grid.
    expect(marks(fill)).toBe(1);
    const size = chordDiagramSize(diagram([1, null, null, null, null, 15]), SPACE);
    for (const p of list)
      expect(p.bbox.y + p.bbox.height).toBeLessThanOrEqual(at.y + size.height + 0.5);
  });

  it('draws finger digits only when the diagram has fingering', () => {
    const plain = draw(diagram(OPEN_C));
    const fingered = draw(
      diagram(OPEN_C, { fingering: ['index', null, null, 'middle', 'ring', null] }),
    );
    expect(texts(plain)).toEqual([]);
    expect(texts(fingered)).toEqual(['1', '2', '3']);
    expect(
      chordDiagramSize(
        diagram(OPEN_C, { fingering: ['index', null, null, null, null, null] }),
        SPACE,
      ).height,
    ).toBeGreaterThan(chordDiagramSize(diagram(OPEN_C), SPACE).height);
  });

  it('draws 7 and 4 strings with the width following the string count', () => {
    const six = chordDiagramSize(diagram(OPEN_C), SPACE).width;
    const seven = chordDiagramSize(diagram([0, 1, 0, 2, 3, null, null]), SPACE).width;
    const four = chordDiagramSize(diagram([0, 2, 2, null]), SPACE).width;
    expect(seven - six).toBeCloseTo(DIAGRAM.stringGap * SPACE, 1);
    expect(six - four).toBeCloseTo(2 * DIAGRAM.stringGap * SPACE, 1);
    expect(marks(draw(diagram([0, 2, 2, null]))[0] as PathPrimitive)).toBe(4 + 5);
  });

  it('keeps a diagram to five primitives plus one per fingered string', () => {
    const full = diagram([1, 1, 2, 3, 3, 1, null], {
      barres: [
        { fret: 1, firstString: 1, lastString: 3 },
        { fret: 3, firstString: 4, lastString: 5 },
        { fret: 1, firstString: 6, lastString: 6 },
      ],
      fingering: ['index', 'index', 'middle', 'ring', 'little', 'thumb', null],
      baseFret: 1,
    });
    // Grid, nut, fill, open and muted strokes, then six digits.
    expect(draw(full).length).toBeLessThanOrEqual(5 + 6);
    expect(draw(diagram(OPEN_C)).length).toBeLessThanOrEqual(5);
  });

  it('returns nothing for a diagram without strings', () => {
    expect(draw(diagram([]))).toEqual([]);
    expect(chordDiagramSize(diagram([]), SPACE)).toEqual({ width: 0, height: 0 });
  });

  it('matches the snapshots of open C and the F barre', () => {
    expect(draw(diagram(OPEN_C))).toMatchSnapshot();
    expect(
      draw(diagram(F_BARRE, { barres: [{ fret: 1, firstString: 1, lastString: 6 }] })),
    ).toMatchSnapshot();
  });

  it('keeps every primitive inside the box', () => {
    const d = diagram(F_BARRE, {
      barres: [{ fret: 1, firstString: 1, lastString: 6 }],
      fingering: ['index', 'index', 'middle', 'ring', 'little', 'index'],
    });
    const { width, height } = chordDiagramSize(d, SPACE);
    for (const p of draw(d)) {
      expect(p.bbox.x).toBeGreaterThanOrEqual(at.x - 0.5);
      expect(p.bbox.y).toBeGreaterThanOrEqual(at.y - 0.5);
      expect(p.bbox.x + p.bbox.width).toBeLessThanOrEqual(at.x + width + 0.5);
      expect(p.bbox.y + p.bbox.height).toBeLessThanOrEqual(at.y + height + 0.5);
    }
  });
});

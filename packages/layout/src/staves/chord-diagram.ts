import type { ChordDiagram, Finger, Id } from '@reprise/model';

import { engraving, textWidth } from '../metrics';
import { line, path, point, rect, round, text, union } from '../primitives';
import type { PathPrimitive, Primitive, Rect, ThemeRole } from '../types';

/**
 * The shape of a chord diagram, in staff spaces: Guitar Pro's grid with the strings running low to
 * high from left to right, so string 1 is on the right.
 */
export const DIAGRAM = {
  stringGap: 0.8,
  fretGap: 1,
  /** The fewest fret rows a grid shows; a wider span adds rows. */
  minRows: 4,
  /** The open and muted marks above the nut. */
  markRow: 0.9,
  /** The finger digits under the grid, drawn only when the diagram carries fingering. */
  fingerRow: 1,
  /** Room either side of the outer strings, for a dot or a barre's round end. */
  side: 0.4,
  dotRadius: 0.32,
  markRadius: 0.2,
  /** The base-fret label and the finger digits. */
  textSize: 0.9,
  /** The nut is this many times the line thickness. */
  nut: 3,
} as const;

/** Where a diagram is drawn: (x, y) is the top-left of its box. */
export interface ChordDiagramAt {
  x: number;
  y: number;
  /** One staff space in px. */
  space: number;
  /** The beat or other node a click on the diagram means; set on every primitive. */
  node?: Id;
  role?: ThemeRole;
}

interface Grid {
  strings: number;
  /** The fret of the first row. */
  start: number;
  rows: number;
  label: string;
  fingered: boolean;
}

/**
 * Where the grid starts and how many rows it shows. It starts at `baseFret`, or at the lowest
 * fretted string when that is lower, so a damaged file never draws a dot off the grid; a diagram
 * that claims fret 1 yet reaches past the fourth fret starts at its lowest fretted string.
 */
function gridOf(diagram: ChordDiagram): Grid {
  const frets = diagram.frets.filter((fret): fret is number => fret !== null && fret > 0);
  for (const barre of diagram.barres ?? []) frets.push(barre.fret);
  const lowest = frets.length > 0 ? Math.min(...frets) : diagram.baseFret;
  const highest = frets.length > 0 ? Math.max(...frets) : diagram.baseFret;
  const start =
    diagram.baseFret === 1 && highest > DIAGRAM.minRows
      ? lowest
      : Math.min(diagram.baseFret, lowest);
  return {
    strings: diagram.frets.length,
    start,
    rows: Math.max(DIAGRAM.minRows, highest - start + 1),
    label: start > 1 ? `${String(start)}fr` : '',
    fingered: diagram.fingering?.some((finger) => finger !== null) ?? false,
  };
}

function labelWidth(grid: Grid, space: number): number {
  return grid.label === ''
    ? 0
    : textWidth(grid.label, DIAGRAM.textSize * space) + DIAGRAM.markRadius * space;
}

/** The size of a diagram's box in px: base-fret label, marks above, grid and finger row. */
export function chordDiagramSize(
  diagram: ChordDiagram,
  space: number,
): { width: number; height: number } {
  const grid = gridOf(diagram);
  if (grid.strings === 0) return { width: 0, height: 0 };
  const width =
    labelWidth(grid, space) + (2 * DIAGRAM.side + (grid.strings - 1) * DIAGRAM.stringGap) * space;
  const height =
    (DIAGRAM.markRow + grid.rows * DIAGRAM.fretGap + (grid.fingered ? DIAGRAM.fingerRow : 0)) *
    space;
  return { width: round(width), height: round(height) };
}

const FINGER_DIGIT: Record<Finger, string> = {
  thumb: 'T',
  index: '1',
  middle: '2',
  ring: '3',
  little: '4',
};

/** Path data and extent of shapes built point by point. */
class Shape {
  d = '';
  private left = Infinity;
  private top = Infinity;
  private right = -Infinity;
  private bottom = -Infinity;

  cover(x: number, y: number, rx = 0, ry = rx): void {
    this.left = Math.min(this.left, x - rx);
    this.right = Math.max(this.right, x + rx);
    this.top = Math.min(this.top, y - ry);
    this.bottom = Math.max(this.bottom, y + ry);
  }

  move(x: number, y: number): void {
    this.d += `M${point(x, y)}`;
    this.cover(x, y);
  }

  lineTo(x: number, y: number): void {
    this.d += `L${point(x, y)}`;
    this.cover(x, y);
  }

  circle(cx: number, cy: number, r: number): void {
    this.d += `M${point(cx - r, cy)}a${String(round(r))} ${String(round(r))} 0 1 0 ${String(round(2 * r))} 0a${String(round(r))} ${String(round(r))} 0 1 0 ${String(round(-2 * r))} 0Z`;
    this.cover(cx, cy, r);
  }

  /** A bar with round ends from `x1` to `x2`, `r` either side of the centre line `cy`. */
  bar(x1: number, x2: number, cy: number, r: number): void {
    const width = round(x2 - x1);
    this.d += `M${point(x1, cy - r)}h${String(width)}a${String(round(r))} ${String(round(r))} 0 0 1 0 ${String(round(2 * r))}h${String(-width)}a${String(round(r))} ${String(round(r))} 0 0 1 0 ${String(round(-2 * r))}Z`;
    this.cover((x1 + x2) / 2, cy, (x2 - x1) / 2 + r, r);
  }

  get empty(): boolean {
    return this.d === '';
  }

  box(): Rect {
    return rect(this.left, this.top, this.right - this.left, this.bottom - this.top);
  }
}

/**
 * The primitives of one diagram: a stroked path for the whole grid, which carries the diagram's
 * box and `lane: 'chordDiagram'` so a click anywhere on it finds the beat; the nut or the
 * base-fret label; one filled path for the dots, one for the barres, one stroked path each for
 * the open circles and the muted crosses; and a digit per fingered string. That is at most 12, as
 * the painter mounts one SVG element per primitive.
 */
export function chordDiagramPrimitives(diagram: ChordDiagram, at: ChordDiagramAt): Primitive[] {
  const { x, y, space, node } = at;
  const grid = gridOf(diagram);
  if (grid.strings === 0) return [];
  const options = { role: at.role ?? 'ink', ...(node !== undefined && { node }) } as const;
  const thickness = engraving.staffLineThickness * space;
  const size = chordDiagramSize(diagram, space);
  const stringGap = DIAGRAM.stringGap * space;
  const fretGap = DIAGRAM.fretGap * space;
  const left = x + labelWidth(grid, space) + DIAGRAM.side * space;
  const top = y + DIAGRAM.markRow * space;
  const bottom = top + grid.rows * fretGap;
  const right = left + (grid.strings - 1) * stringGap;
  const stringX = (index: number) => right - index * stringGap;
  const rowY = (fret: number) => top + (fret - grid.start + 0.5) * fretGap;
  const inGrid = (fret: number) => fret >= grid.start && fret < grid.start + grid.rows;

  const lines = new Shape();
  for (let i = 0; i < grid.strings; i += 1) {
    lines.move(stringX(i), top);
    lines.lineTo(stringX(i), bottom);
  }
  // At fret 1 the nut is the grid's top edge, drawn thicker on its own.
  for (let row = grid.start === 1 ? 1 : 0; row <= grid.rows; row += 1) {
    lines.move(left, top + row * fretGap);
    lines.lineTo(right, top + row * fretGap);
  }
  const box = rect(x, y, size.width, size.height);
  const primitives: Primitive[] = [
    {
      ...path(lines.d, box, false, thickness, options),
      lane: 'chordDiagram',
    } satisfies PathPrimitive,
  ];

  if (grid.start === 1) {
    primitives.push(line(left, top, right, top, thickness * DIAGRAM.nut, options));
  } else {
    const labelSize = DIAGRAM.textSize * space;
    primitives.push(text(grid.label, x, rowY(grid.start) + labelSize * 0.35, labelSize, options));
  }

  const dots = new Shape();
  const bars = new Shape();
  const open = new Shape();
  const muted = new Shape();
  const barres = (diagram.barres ?? []).filter((barre) => inGrid(barre.fret));
  for (const barre of barres) {
    const first = stringX(Math.min(barre.firstString, barre.lastString) - 1);
    const last = stringX(Math.max(barre.firstString, barre.lastString) - 1);
    bars.bar(
      Math.min(first, last),
      Math.max(first, last),
      rowY(barre.fret),
      DIAGRAM.dotRadius * space,
    );
  }
  for (const [i, fret] of diagram.frets.entries()) {
    const cx = stringX(i);
    if (fret === null) {
      const arm = DIAGRAM.markRadius * space;
      const cy = y + (DIAGRAM.markRow * space) / 2;
      muted.move(cx - arm, cy - arm);
      muted.lineTo(cx + arm, cy + arm);
      muted.move(cx + arm, cy - arm);
      muted.lineTo(cx - arm, cy + arm);
    } else if (fret === 0) {
      open.circle(cx, y + (DIAGRAM.markRow * space) / 2, DIAGRAM.markRadius * space);
    } else if (
      inGrid(fret) &&
      !barres.some(
        (barre) =>
          barre.fret === fret &&
          i + 1 >= Math.min(barre.firstString, barre.lastString) &&
          i + 1 <= Math.max(barre.firstString, barre.lastString),
      )
    ) {
      dots.circle(cx, rowY(fret), DIAGRAM.dotRadius * space);
    }
  }
  const stroked = (shape: Shape) => path(shape.d, shape.box(), false, thickness, options);
  if (!dots.empty || !bars.empty) {
    // The barres and the dots are one fill, so they are one element.
    const boxes = [dots, bars].filter((shape) => !shape.empty).map((shape) => shape.box());
    const area = boxes.reduce(union);
    primitives.push(path(dots.d + bars.d, area, true, 0, options));
  }
  if (!open.empty) primitives.push(stroked(open));
  if (!muted.empty) primitives.push(stroked(muted));

  if (grid.fingered) {
    const digit = DIAGRAM.textSize * space;
    const baseline = bottom + DIAGRAM.fingerRow * space * 0.72;
    for (const [i, finger] of (diagram.fingering ?? []).entries()) {
      if (!finger || i >= grid.strings) continue;
      primitives.push(
        text(FINGER_DIGIT[finger], stringX(i), baseline, digit, { ...options, anchor: 'middle' }),
      );
    }
  }
  return primitives;
}

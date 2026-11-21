import { chordDiagramPrimitives, chordDiagramSize, type Primitive } from '@reprise/layout';
import type { ChordDiagram } from '@reprise/model';

import type { ChordListEntry } from '@/lib/chords';

/** The print strip's metrics, in px: diagrams are drawn smaller than in the score, to fit rows of them. */
export const PRINT_STRIP = {
  space: 6,
  nameSize: 11,
  nameLine: 15,
  /** Between two cells of a row. */
  gap: 14,
  rowGap: 8,
  /** Past this the strip would crowd the first page, so the rest is counted in a "+N more" cell. */
  maxRows: 3,
} as const;

export interface PrintStrip {
  /** In the strip's own frame: (0, 0) is its top-left, `width` is the content width of the page. */
  primitives: Primitive[];
  height: number;
}

type StripEntry = Pick<ChordListEntry, 'name' | 'diagram' | 'suggested'>;

interface Cell {
  entry: StripEntry | undefined;
  /** For the "+N more" cell. */
  more?: string;
  width: number;
  height: number;
  /** The diagram's size, when it has one. */
  box?: { width: number; height: number };
}

// Layout's text metrics are not exported, and a name only needs to centre over its grid and not
// to collide with the next cell, so an average advance is enough.
const ADVANCE = 0.6;
const approximateWidth = (text: string, size: number): number => text.length * size * ADVANCE;

function cellOf(entry: StripEntry): Cell {
  const name = approximateWidth(entry.name, PRINT_STRIP.nameSize);
  if (!entry.diagram) return { entry, width: name, height: PRINT_STRIP.nameLine };
  const box = chordDiagramSize(entry.diagram, PRINT_STRIP.space);
  return {
    entry,
    box,
    width: Math.max(name, box.width),
    height: PRINT_STRIP.nameLine + box.height,
  };
}

function textAt(content: string, x: number, y: number, role: 'ink' | 'muted'): Primitive {
  const size = PRINT_STRIP.nameSize;
  const width = approximateWidth(content, size);
  return {
    kind: 'text',
    text: content,
    x,
    y,
    size,
    anchor: 'middle',
    italic: false,
    role,
    bbox: { x: x - width / 2, y: y - size, width, height: size * 1.25 },
  };
}

function diagramPrimitives(
  diagram: ChordDiagram,
  x: number,
  y: number,
  role: 'ink' | 'muted',
): Primitive[] {
  return chordDiagramPrimitives(diagram, { x, y, space: PRINT_STRIP.space, role });
}

/**
 * Rows of chord names over their diagrams, flowed across `width`: what a printed page shows under
 * the title when the chord strip is on. A suggested shape (the engine's, not the file's) and its
 * name are muted, as on screen. Pure, so print and image export draw the same.
 */
export function stripLayout(entries: readonly StripEntry[], width: number): PrintStrip | undefined {
  if (entries.length === 0 || width <= 0) return undefined;
  const rows: Cell[][] = [[]];
  let used = 0;
  let placed = 0;
  const open = (cell: Cell): Cell[] | undefined => {
    let row = rows.at(-1);
    if (row && row.length > 0 && used + PRINT_STRIP.gap + cell.width > width) {
      if (rows.length === PRINT_STRIP.maxRows) return undefined;
      row = [];
      rows.push(row);
      used = 0;
    }
    return row;
  };
  for (const entry of entries) {
    const cell = cellOf(entry);
    const row = open(cell);
    if (!row) break;
    used += (row.length > 0 ? PRINT_STRIP.gap : 0) + cell.width;
    row.push(cell);
    placed += 1;
  }
  if (placed < entries.length) {
    const last = rows.at(-1) ?? [];
    const make = (): Cell => {
      const label = `+${String(entries.length - placed)} more`;
      return {
        entry: undefined,
        more: label,
        width: approximateWidth(label, PRINT_STRIP.nameSize),
        height: PRINT_STRIP.nameLine,
      };
    };
    const widthOfRow = () => last.reduce((sum, cell) => sum + cell.width + PRINT_STRIP.gap, 0);
    // Drop cells from the end of the last row until the count fits beside the rest.
    while (last.length > 1 && widthOfRow() + make().width > width) {
      last.pop();
      placed -= 1;
    }
    last.push(make());
  }

  const primitives: Primitive[] = [];
  let top = 0;
  rows.forEach((row, rowIndex) => {
    const rowHeight = Math.max(...row.map((cell) => cell.height));
    let x = 0;
    for (const cell of row) {
      const centre = x + cell.width / 2;
      const baseline = top + PRINT_STRIP.nameSize;
      const { entry } = cell;
      if (cell.more !== undefined) {
        primitives.push(textAt(cell.more, centre, baseline, 'muted'));
      } else if (entry) {
        const role = entry.suggested ? 'muted' : 'ink';
        primitives.push(textAt(entry.name, centre, baseline, role));
        if (entry.diagram && cell.box) {
          primitives.push(
            ...diagramPrimitives(
              entry.diagram,
              centre - cell.box.width / 2,
              top + PRINT_STRIP.nameLine,
              role,
            ),
          );
        }
      }
      x += cell.width + PRINT_STRIP.gap;
    }
    top += rowHeight + (rowIndex < rows.length - 1 ? PRINT_STRIP.rowGap : 0);
  });
  return { primitives, height: top };
}

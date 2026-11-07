import type { Id } from '@reprise/model';

import { textExtent, textWidth } from '../../metrics';
import { box, rect, text, type LayoutSink } from '../../primitives';

/** A connection's letter: its size, and its gap from the arc's apex, in staff spaces. */
export const LETTER = { size: 1, gap: 0.25 } as const;
/** Paper kept around a text so the lines under it stop short, in ems of the text. */
export const KNOCKOUT = { x: 0.12, y: 0.09 } as const;

/** A letter centred on `x` just outside an arc's `apex`, over a paper knockout. */
export function drawLetter(
  sink: LayoutSink,
  x: number,
  apex: number,
  direction: 'up' | 'down',
  space: number,
  node: Id,
  letter: string,
): void {
  const size = LETTER.size * space;
  const { ascent } = textExtent(size);
  const baseline =
    direction === 'up' ? apex - LETTER.gap * space : apex + LETTER.gap * space + ascent;
  const width = textWidth(letter, size);
  const knockX = KNOCKOUT.x * size;
  const knockY = KNOCKOUT.y * size;
  sink.primitives.push(
    box(
      rect(
        x - width / 2 - knockX,
        baseline - ascent - knockY,
        width + 2 * knockX,
        ascent + 2 * knockY,
      ),
      0,
      { fill: true, role: 'paper', node },
    ),
    text(letter, x, baseline, size, { anchor: 'middle', node }),
  );
}

/** How far a letter reaches past the apex it stands on, in px. */
export function letterReach(space: number): number {
  const size = LETTER.size * space;
  return LETTER.gap * space + textExtent(size).ascent + KNOCKOUT.y * size;
}

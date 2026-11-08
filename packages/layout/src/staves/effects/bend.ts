import type { Bend } from '@reprise/model';

import { textExtent } from '../../metrics';
import type { Rect } from '../../types';
import {
  ARROW_LENGTH,
  arrowhead,
  line,
  path,
  point,
  rect,
  round,
  text,
  type LayoutSink,
} from '../../primitives';
import { BEND_STEP, EFFECT_TEXT } from './analysis';
import { bendLabel } from './labels';

/** Shaft thickness, the gaps around labels and a hold's dashes, in staff spaces. */
const SHAFT = 0.16;
const LABEL_GAP = 0.3;
const RELEASE_LABEL_GAP = 0.4;
const RELEASE_STOP = 0.1;
const HOLD_DASH = 0.4;

/**
 * Where a bend's frame starts and stops, in staff spaces: its gap from the note, how far short of
 * the next onset it ends, its shortest length, and how far short a grace bend stops.
 */
export const BEND_FRAME = { gap: 0.15, stop: 0.6, min: 1, graceStop: 0.3 } as const;
/** Room kept right of a bent note, and right of a grace column holding a bend, in staff spaces. */
export const BEND_ROOM = { main: 2.2, grace: 1.2 } as const;

/** What a beat's bends have drawn so far: keys of shared marks, and the boxes of their labels. */
export interface BendDrawn {
  keys: Set<string>;
  labels: Rect[];
}

export const newBendDrawn = (): BendDrawn => ({ keys: new Set(), labels: [] });

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A bend's highest value, 0 when it never rises or there is none. */
export const bendPeak = (bend: Bend | undefined): number =>
  Math.max(0, ...(bend?.points.map((p) => p.value) ?? []));

/** Where one note's bend is drawn, in px. */
export interface BendFrame {
  /** Where the shaft starts: right of the number, or its centre for a pre-bend. */
  x0: number;
  xEnd: number;
  /** The string the bend starts from, and the bend lane's bottom, which raised values rise from. */
  yBase: number;
  laneBottom: number;
  /** The onset's x and the top of the number's knockout, for pre-bends. */
  onset: number;
  numberTop: number;
  /** The top of the beat's topmost bent number, where every release to zero ends. */
  releaseTop: number;
  /** A tied note continues its bend and gets no pre-bend arrow. */
  tied: boolean;
}

/**
 * Draws a bend as Guitar Pro does: shafts curving up to arrowheads at each raised point with the
 * amount above, down arrows for releases, dashed lines for holds. `drawn` holds the arrowheads
 * and labels already drawn for the beat, so notes bent alike in a chord share them.
 */
export function drawBend(
  sink: LayoutSink,
  bend: Bend,
  frame: BendFrame,
  space: number,
  node: string,
  drawn: BendDrawn,
): void {
  const points = [...bend.points].sort((a, b) => a.position - b.position);
  const top = bendPeak(bend);
  const [first] = points;
  if (top <= 0 || !first) return;
  const size = EFFECT_TEXT * space;
  // As in alphaTab, a raised value is a fixed rise above the staff rather than a share of the way
  // from the note's string, so intermediate values stay above the staff's numbers.
  const level = (value: number): number =>
    value <= 0 ? frame.yBase : frame.laneBottom - BEND_STEP * value * space;
  const prebend = first.value > 0;
  const x0 = prebend ? frame.onset : frame.x0;
  const x = (position: number): number => x0 + (position / 60) * (frame.xEnd - x0);
  const arrow = ARROW_LENGTH * space;
  const once = (key: string, draw: () => void): void => {
    if (drawn.keys.has(key)) return;
    drawn.keys.add(key);
    draw();
  };
  const raised = (px: number, tip: number, value: number): void => {
    once(`arrow ${String(round(px))} ${String(round(tip))} up`, () => {
      sink.primitives.push(arrowhead(px, tip, 'up', space, { node }));
    });
    once(`label ${String(round(px))} ${String(round(tip))}`, () => {
      const label = text(bendLabel(value), px, tip - LABEL_GAP * space, size, {
        anchor: 'middle',
        node,
      });
      // A label that would land on one already drawn is dropped: the repeat of a many-peak bend,
      // or the lower amount of a chord, whose notes are drawn highest bend first.
      if (drawn.labels.some((other) => overlap(other, label.bbox))) return;
      drawn.labels.push(label.bbox);
      sink.primitives.push(label);
    });
  };

  if (prebend && !frame.tied) {
    const tip = level(first.value);
    // In a chord the top note's arrow stands for all: a lower one would cross the numbers above.
    once(`prebend ${String(round(x0))}`, () => {
      if (frame.numberTop - tip > arrow) {
        sink.primitives.push(line(x0, frame.numberTop, x0, tip + arrow, SHAFT * space, { node }));
      }
    });
    raised(x0, tip, first.value);
  }
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    if (!p || !q) continue;
    const xp = x(p.position);
    const xq = Math.max(x(q.position), xp);
    const yp = level(p.value);
    if (q.value > p.value) {
      const tip = level(q.value);
      shaft(sink, xp, yp, xq, tip + arrow, space, node);
      raised(xq, tip, q.value);
    } else if (q.value < p.value) {
      const tip = q.value <= 0 ? frame.releaseTop - RELEASE_STOP * space : level(q.value);
      shaft(sink, xp, yp, xq, tip - arrow, space, node);
      once(`arrow ${String(round(xq))} ${String(round(tip))} down`, () => {
        sink.primitives.push(arrowhead(xq, tip, 'down', space, { node }));
      });
      if (q.value > 0) {
        once(`label ${String(round(xq))} ${String(round(tip))}`, () => {
          const y = tip + textExtent(size).ascent / 2;
          sink.primitives.push(
            text(bendLabel(q.value), xq + RELEASE_LABEL_GAP * space, y, size, { node }),
          );
        });
      }
    } else if (p.value > 0 && xq > xp) {
      once(`hold ${String(round(xp))} ${String(round(xq))} ${String(round(yp))}`, () => {
        const dash: [number, number] = [HOLD_DASH * space, HOLD_DASH * space];
        sink.primitives.push(line(xp, yp, xq, yp, SHAFT * space, { dash, node }));
      });
    }
  }
}

function shaft(
  sink: LayoutSink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  space: number,
  node: string,
): void {
  const d = `M${point(x0, y0)}C${point((x0 + x1) / 2, y0)} ${point(x1, y0)} ${point(x1, y1)}`;
  const box = rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  sink.primitives.push(path(d, box, false, SHAFT * space, { node }));
}

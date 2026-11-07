import type { Anchor } from '@reprise/layout';

import type { ScorePointerEvent } from './score-view';

/** Screen px a press may move and still be a click. */
export const CLICK_SLOP = 4;

export type Gesture =
  /** A press released where it began; `event` is the press. */
  | { kind: 'click'; event: ScorePointerEvent; shift: boolean }
  /** A press moved from one bar column to another; reported per new column, then once `done`. */
  | { kind: 'drag'; from: Anchor; to: Anchor; done: boolean }
  /** A drag the system took away; whatever it previewed is dropped. */
  | { kind: 'cancel' };

interface Press {
  event: ScorePointerEvent;
  x: number;
  y: number;
  dragging: boolean;
  to: Anchor | undefined;
}

/** Turns the primary button's pointer events into clicks and drags over bar columns. */
export function createGestureTracker(): { handle(event: ScorePointerEvent): Gesture | undefined } {
  let press: Press | undefined;

  return {
    handle(event) {
      const { type, event: native } = event;
      if (type === 'down') {
        press =
          native.button === 0
            ? { event, x: native.clientX, y: native.clientY, dragging: false, to: event.column }
            : undefined;
        return undefined;
      }
      if (!press) return undefined;
      if (type === 'cancel') {
        const wasDragging = press.dragging;
        press = undefined;
        return wasDragging ? { kind: 'cancel' } : undefined;
      }
      if (type === 'leave') return undefined;

      const from = press.event.column;
      const moved = Math.hypot(native.clientX - press.x, native.clientY - press.y) > CLICK_SLOP;
      const starts = !press.dragging && moved && from !== undefined;
      if (starts) press.dragging = true;

      if (type === 'up') {
        const done = press;
        press = undefined;
        if (!done.dragging) {
          return { kind: 'click', event: done.event, shift: done.event.event.shiftKey };
        }
        const to = event.column ?? done.to;
        return from && to ? { kind: 'drag', from, to, done: true } : { kind: 'cancel' };
      }

      if (!press.dragging || !from || !event.column) return undefined;
      const changed = press.to?.id !== event.column.id;
      press.to = event.column;
      return starts || changed ? { kind: 'drag', from, to: event.column, done: false } : undefined;
    },
  };
}

import type { Anchor } from '@reprise/layout';

import type { ScorePointerEvent } from './score-view';

/** Screen px a press may move and still be a click. */
export const CLICK_SLOP = 4;

export type Gesture =
  /** A press released where it began; `event` is the press. */
  | { kind: 'click'; event: ScorePointerEvent; shift: boolean }
  /** A press moved from one bar column to another; reported per new column, then once `done`. */
  | { kind: 'drag'; from: Anchor; to: Anchor; done: boolean }
  /**
   * A press dragged across the score, whatever it crosses; reported on every move, then once `done`. Only in the `area` drag mode, which the editor uses.
   */
  | { kind: 'area'; from: ScorePointerEvent; to: ScorePointerEvent; done: boolean }
  /** A drag the system took away; whatever it previewed is dropped. */
  | { kind: 'cancel' };

interface Press {
  event: ScorePointerEvent;
  x: number;
  y: number;
  dragging: boolean;
  to: Anchor | undefined;
}

/** `columns`: drags between bar columns (play mode). `area`: drags anywhere, point to point (edit mode). */
export type DragMode = 'columns' | 'area';

function handleArea(
  press: Press,
  event: ScorePointerEvent,
  moved: boolean,
  end: () => void,
): Gesture | undefined {
  const starts = !press.dragging && moved;
  if (starts) press.dragging = true;
  if (event.type === 'up') {
    const done = press;
    end();
    return done.dragging
      ? { kind: 'area', from: done.event, to: event, done: true }
      : { kind: 'click', event: done.event, shift: done.event.event.shiftKey };
  }
  if (!press.dragging) return undefined;
  // Every move, not only a new anchor: the editor resolves the nearest beat by x and the string by
  // y inside one bar anchor, so the preview must follow the pointer there too.
  return { kind: 'area', from: press.event, to: event, done: false };
}

export interface GestureOptions {
  /**
   * A primary press with Ctrl is a context click, which macOS raises as a `contextmenu` event: it
   * neither seeks nor selects. Set on the mac keyboard platform only, where Ctrl is not the
   * command key. Read at each press.
   */
  ctrlIsContextClick?: () => boolean;
}

/** Turns the primary button's pointer events into clicks and drags over bar columns. */
export function createGestureTracker(options: GestureOptions = {}): {
  handle(event: ScorePointerEvent, drag?: DragMode): Gesture | undefined;
} {
  let press: Press | undefined;

  return {
    handle(event, drag = 'columns') {
      const { type, event: native } = event;
      if (type === 'down') {
        press =
          native.button === 0 && !(options.ctrlIsContextClick?.() && native.ctrlKey)
            ? {
                event,
                x: native.clientX,
                y: native.clientY,
                dragging: false,
                to: event.column,
              }
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

      const moved = Math.hypot(native.clientX - press.x, native.clientY - press.y) > CLICK_SLOP;
      if (drag === 'area') return handleArea(press, event, moved, () => (press = undefined));

      const from = press.event.column;
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

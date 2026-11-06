import type { Anchor } from '@reprise/layout';
import { describe, expect, it } from 'vitest';

import { createGestureTracker } from './gestures';
import type { ScorePointerEvent } from './score-view';

const column = (id: string): Anchor => ({
  kind: 'bar',
  id,
  system: 0,
  bbox: { x: 0, y: 0, width: 100, height: 100 },
});

function pointer(
  type: ScorePointerEvent['type'],
  x: number,
  bar: string | undefined,
  init: { button?: number; shiftKey?: boolean } = {},
): ScorePointerEvent {
  const event = new PointerEvent('pointerdown', { clientX: x, clientY: 10, ...init });
  return {
    type,
    point: { x, y: 10 },
    anchor: undefined,
    column: bar === undefined ? undefined : column(bar),
    event,
  };
}

describe('the gesture tracker', () => {
  it('reads a press that moves under 4 px as a click, with Shift', () => {
    const tracker = createGestureTracker();
    const down = pointer('down', 10, 'a', { shiftKey: true });
    expect(tracker.handle(down)).toBeUndefined();
    expect(tracker.handle(pointer('move', 13, 'a'))).toBeUndefined();
    expect(tracker.handle(pointer('up', 13, 'a'))).toEqual({
      kind: 'click',
      event: down,
      shift: true,
    });
  });

  it('reads a longer press as a drag, reported per new column and once done', () => {
    const tracker = createGestureTracker();
    tracker.handle(pointer('down', 10, 'a'));
    expect(tracker.handle(pointer('move', 15, 'a'))).toMatchObject({
      kind: 'drag',
      from: { id: 'a' },
      to: { id: 'a' },
      done: false,
    });
    expect(tracker.handle(pointer('move', 20, 'a'))).toBeUndefined();
    expect(tracker.handle(pointer('move', 120, 'b'))).toMatchObject({
      to: { id: 'b' },
      done: false,
    });
    expect(tracker.handle(pointer('leave', 400, undefined))).toBeUndefined();
    expect(tracker.handle(pointer('up', 400, undefined))).toMatchObject({
      kind: 'drag',
      to: { id: 'b' },
      done: true,
    });
  });

  it('gives nothing for a cancelled click or another button, and cancels a drag', () => {
    const tracker = createGestureTracker();
    tracker.handle(pointer('down', 10, 'a'));
    expect(tracker.handle(pointer('cancel', 10, undefined))).toBeUndefined();
    expect(tracker.handle(pointer('up', 10, 'a'))).toBeUndefined();

    tracker.handle(pointer('down', 10, 'a', { button: 2 }));
    expect(tracker.handle(pointer('up', 10, 'a'))).toBeUndefined();

    tracker.handle(pointer('down', 10, 'a'));
    tracker.handle(pointer('move', 120, 'b'));
    expect(tracker.handle(pointer('cancel', 120, undefined))).toEqual({ kind: 'cancel' });
  });
});

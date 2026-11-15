import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

const KEYBOARD_STEP = 16;

interface ResizeHandleProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /**
   * 1 when dragging right (or down) grows the panel (a left panel), -1 for a right panel, and for
   * a bottom one, where dragging or pressing up grows it.
   */
  direction: 1 | -1;
  /** `x` (the default) resizes a width and its separator is vertical; `y` resizes a height. */
  axis?: 'x' | 'y';
  onResize: (size: number) => void;
  /** Fires when a drag ends or after a key press: the moment to store the size. */
  onResizeEnd?: () => void;
}

export function ResizeHandle({
  label,
  value,
  min,
  max,
  direction,
  axis = 'x',
  onResize,
  onResizeEnd,
}: ResizeHandleProps) {
  const drag = useRef<{ start: number; size: number } | undefined>(undefined);
  const pointer = (event: PointerEvent<HTMLDivElement>) =>
    axis === 'x' ? event.clientX : event.clientY;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Stops the compatibility mouse events, so a drag does not select text; focus is then ours to move.
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: pointer(event), size: value };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(drag.current.size + direction * (pointer(event) - drag.current.start));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = undefined;
    onResizeEnd?.();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys =
      axis === 'x'
        ? { ArrowLeft: -KEYBOARD_STEP, ArrowRight: KEYBOARD_STEP }
        : { ArrowUp: -KEYBOARD_STEP, ArrowDown: KEYBOARD_STEP };
    const step = (keys as Record<string, number>)[event.key];
    if (step === undefined) return;
    event.preventDefault();
    onResize(value + direction * step);
    onResizeEnd?.();
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`hover:bg-ring/40 focus-visible:bg-ring/60 relative z-10 shrink-0 touch-none bg-transparent outline-none ${axis === 'x' ? '-mx-0.5 w-1 cursor-col-resize' : '-my-0.5 h-1 cursor-row-resize'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}

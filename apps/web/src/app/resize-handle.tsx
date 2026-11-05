import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

const KEYBOARD_STEP = 16;

interface ResizeHandleProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** 1 when dragging right widens the panel (a left panel), -1 for a right panel. */
  direction: 1 | -1;
  onResize: (width: number) => void;
}

export function ResizeHandle({ label, value, min, max, direction, onResize }: ResizeHandleProps) {
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: value };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(drag.current.width + direction * (event.clientX - drag.current.x));
  };
  const onPointerUp = () => {
    drag.current = undefined;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -KEYBOARD_STEP, ArrowRight: KEYBOARD_STEP }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    onResize(value + direction * step);
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="hover:bg-ring/40 focus-visible:bg-ring/60 relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize touch-none bg-transparent outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}

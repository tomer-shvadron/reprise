import { useLayoutEffect, useRef } from 'react';

import { useAppServices } from '@/app/services-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { startPositionReader } from '@/state/position-reader';
import { timelineOf } from '@/state/timeline';

import { describePosition } from './position-format';

function write(span: HTMLSpanElement | null, text: string) {
  if (span && span.textContent !== text) span.textContent = text;
}

/**
 * Bar, beat and time. The engine moves the position every frame, so the spans are written from
 * the position reader directly and React never renders for it.
 */
export function PositionReadout() {
  const { playback, document } = useAppServices();
  const bar = useRef<HTMLSpanElement>(null);
  const beat = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const reader = startPositionReader(playback, (event) => {
      const { score } = document.getState();
      const text = describePosition(score && timelineOf(score), event);
      write(bar.current, text.bar);
      write(beat.current, text.beat);
      write(time.current, text.time);
    });
    const unsubscribe = document.subscribe((state, previous) => {
      if (state.score !== previous.score) reader.refresh();
    });
    return () => {
      unsubscribe();
      reader.stop();
    };
  }, [playback, document]);

  return (
    <div
      role="group"
      aria-label="Position"
      data-position-readout
      className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums"
    >
      <span>
        <span className="sr-only">Bar </span>
        <span ref={bar} data-field="bar" className="inline-block min-w-[5ch] text-right" />
      </span>
      <span aria-hidden>·</span>
      <span>
        <span className="sr-only">Beat </span>
        <span ref={beat} data-field="beat" className="inline-block min-w-[8ch] text-center" />
      </span>
      <span aria-hidden>·</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <span className="sr-only">Time at the written tempo </span>
            <span ref={time} data-field="time" className="inline-block min-w-[11ch]" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          The song’s own clock, at the written tempo, whatever the speed
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

import { chordDiagramPrimitives, chordDiagramSize } from '@reprise/layout';
import type { ChordDiagram } from '@reprise/model';
import { cn } from 'cn';
import type { KeyboardEvent, Ref } from 'react';

import { renderPrimitive } from '@/features/score';

const SPACE = 11;
const PAD = 6;

/** "x 0 2 2 1 0", low string first as players read a shape. */
export function shapeLabel(diagram: ChordDiagram): string {
  return [...diagram.frets]
    .reverse()
    .map((fret) => (fret === null ? 'x' : String(fret)))
    .join(' ');
}

export interface ChordCardProps {
  name: string;
  diagram: ChordDiagram;
  /** A generated shape, as opposed to one the song carries. */
  suggested?: boolean;
  tabIndex?: number;
  buttonRef?: Ref<HTMLButtonElement>;
  onPlay: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/** One diagram, painted with the layout's renderer in the score's colours; a click strums it. */
export function ChordCard({
  name,
  diagram,
  suggested = true,
  tabIndex,
  buttonRef,
  onPlay,
  onKeyDown,
}: ChordCardProps) {
  const size = chordDiagramSize(diagram, SPACE);
  const primitives = chordDiagramPrimitives(diagram, { x: PAD, y: PAD, space: SPACE });
  const position = diagram.baseFret > 1 ? `position ${String(diagram.baseFret)}` : 'open position';
  return (
    <button
      type="button"
      ref={buttonRef}
      tabIndex={tabIndex}
      aria-label={`${name}, ${position}: ${shapeLabel(diagram)}${suggested ? ', suggestion' : ''}`}
      onClick={onPlay}
      onKeyDown={onKeyDown}
      className={cn(
        'score-chord-card bg-card text-card-foreground hover:bg-accent focus-visible:ring-ring flex flex-col items-center gap-1 rounded-md border p-1.5 outline-none focus-visible:ring-2',
      )}
    >
      <div
        className="score-view rounded-sm"
        style={{ background: 'var(--score-paper)', color: 'var(--score-ink)' }}
      >
        <svg
          width={size.width + 2 * PAD}
          height={size.height + 2 * PAD}
          viewBox={`0 0 ${String(size.width + 2 * PAD)} ${String(size.height + 2 * PAD)}`}
          aria-hidden
        >
          {primitives.map((primitive, index) => renderPrimitive(primitive, index))}
        </svg>
      </div>
      {suggested && <span className="text-muted-foreground text-[10px]">Suggestion</span>}
    </button>
  );
}

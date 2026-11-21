import { chordDiagramPrimitives, chordDiagramSize } from '@reprise/layout';
import type { ChordDiagram } from '@reprise/model';
import type { KeyboardEvent, Ref } from 'react';

import { renderPrimitive } from '@/features/score';
import { cn } from 'cn';

export const SPACE = 11;
export const PAD = 6;

export interface DiagramBox {
  width: number;
  height: number;
}

/** The largest diagram box of a list, so every card is the same size and the grids line up. */
export function boxOf(diagrams: readonly ChordDiagram[]): DiagramBox {
  let width = 0;
  let height = 0;
  for (const diagram of diagrams) {
    const size = chordDiagramSize(diagram, SPACE);
    width = Math.max(width, size.width);
    height = Math.max(height, size.height);
  }
  return { width, height };
}

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
  /** The list's shared box; the diagram is drawn at its right edge, so a base-fret label has a gutter. */
  box: DiagramBox;
  /** The shape the write buttons use. */
  picked: boolean;
  tabIndex: number;
  buttonRef?: Ref<HTMLButtonElement>;
  onPlay: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * One generated shape, painted with the layout's renderer on the paper colours (both themes), so
 * it is always marked a suggestion. A click strums it and picks it.
 */
export function ChordCard({
  name,
  diagram,
  box,
  picked,
  tabIndex,
  buttonRef,
  onPlay,
  onFocus,
  onKeyDown,
}: ChordCardProps) {
  const size = chordDiagramSize(diagram, SPACE);
  const x = PAD + box.width - size.width;
  const primitives = chordDiagramPrimitives(diagram, { x, y: PAD, space: SPACE });
  const position = diagram.baseFret > 1 ? `position ${String(diagram.baseFret)}` : 'open position';
  const width = box.width + 2 * PAD;
  const height = box.height + 2 * PAD;
  return (
    <button
      type="button"
      ref={buttonRef}
      tabIndex={tabIndex}
      aria-pressed={picked}
      aria-label={`${name}, ${position}: ${shapeLabel(diagram)}, suggestion`}
      onClick={onPlay}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={cn(
        'bg-card text-card-foreground hover:bg-accent focus-visible:ring-ring flex flex-col items-center gap-1 rounded-md border p-1.5 outline-none focus-visible:ring-2',
        picked && 'border-primary ring-primary ring-2',
      )}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        aria-hidden
        className="bg-paper text-ink rounded-sm"
      >
        {primitives.map((primitive, index) => renderPrimitive(primitive, index))}
      </svg>
      <span className="text-muted-foreground text-[10px]">Suggestion</span>
    </button>
  );
}

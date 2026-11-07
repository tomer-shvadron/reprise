import type { Anchor, Range, Rect } from '@reprise/layout';
import type { CSSProperties } from 'react';

export interface ScoreOverlays {
  selection?: readonly Anchor[];
  /** The active loop's bar columns. */
  loop?: readonly Anchor[];
  hover?: Anchor;
}

function box(rect: Rect, zoom: number): CSSProperties {
  return {
    transform: `translate(${String(rect.x * zoom)}px, ${String(rect.y * zoom)}px)`,
    width: rect.width * zoom,
    height: rect.height * zoom,
  };
}

export interface OverlayLayerProps {
  overlays: ScoreOverlays | undefined;
  zoom: number;
  /** Mounted systems; selection outside them is not drawn. */
  range: Range;
  /** A layout rect of a system in view px, where its page has moved down. */
  place: (rect: Rect, system: number) => Rect;
}

/**
 * Above the notation rather than under it: tab numbers sit on opaque paper knockouts, which a
 * highlight underneath would show as holes. A translucent tint on top colours both alike.
 */
export function OverlayLayer({ overlays, zoom, range, place }: OverlayLayerProps) {
  const { selection = [], loop = [], hover } = overlays ?? {};
  const boxes = (anchors: readonly Anchor[], className: string) =>
    anchors
      .filter((anchor) => anchor.system >= range.start && anchor.system < range.end)
      .map((anchor, index) => (
        <div
          key={`${className}-${String(index)}`}
          className={className}
          style={box(place(anchor.bbox, anchor.system), zoom)}
        />
      ));
  return (
    <div className="score-overlays" aria-hidden="true">
      {boxes(loop, 'score-loop')}
      {boxes(selection, 'score-selection')}
      {hover && <div className="score-hover" style={box(place(hover.bbox, hover.system), zoom)} />}
    </div>
  );
}

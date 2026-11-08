import { anchorBox, type Anchor, type LayoutResult, type Range, type Rect } from '@reprise/layout';
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
  layout: LayoutResult;
  /** Mounted systems; selection outside them is not drawn. */
  range: Range;
}

/**
 * Above the notation rather than under it: tab numbers sit on opaque paper knockouts, which a
 * highlight underneath would show as holes. A translucent tint on top colours both alike.
 */
export function OverlayLayer({ overlays, zoom, layout, range }: OverlayLayerProps) {
  const { selection = [], loop = [], hover } = overlays ?? {};
  const boxes = (anchors: readonly Anchor[], className: string) =>
    anchors
      .filter((anchor) => anchor.system >= range.start && anchor.system < range.end)
      .map((anchor, index) => (
        <div
          key={`${className}-${String(index)}`}
          className={className}
          style={box(anchorBox(layout, anchor), zoom)}
        />
      ));
  return (
    <div className="score-overlays" aria-hidden="true">
      {boxes(loop, 'score-loop')}
      {boxes(selection, 'score-selection')}
      {hover && <div className="score-hover" style={box(anchorBox(layout, hover), zoom)} />}
    </div>
  );
}

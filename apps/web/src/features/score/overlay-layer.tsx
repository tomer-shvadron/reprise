import type { Anchor, Range, Rect } from '@reprise/layout';
import type { CSSProperties } from 'react';

import type { PlaybackCursor } from './anchors';

export interface ScoreOverlays {
  cursor?: PlaybackCursor;
  selection?: readonly Anchor[];
  hover?: Anchor;
}

const CURSOR_WIDTH = 2;

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
  const { cursor, selection = [], hover } = overlays ?? {};
  const bar = cursor && place(cursor.bar.bbox, cursor.bar.system);
  return (
    <div className="score-overlays" aria-hidden="true">
      {cursor && bar && (
        <>
          <div className="score-bar-highlight" style={box(bar, zoom)} />
          <div
            className="score-cursor"
            style={{
              transform: `translate(${String(cursor.x * zoom - CURSOR_WIDTH / 2)}px, ${String(bar.y * zoom)}px)`,
              height: bar.height * zoom,
            }}
          />
        </>
      )}
      {selection
        .filter((anchor) => anchor.system >= range.start && anchor.system < range.end)
        .map((anchor, index) => (
          <div
            key={index}
            className="score-selection"
            style={box(place(anchor.bbox, anchor.system), zoom)}
          />
        ))}
      {hover && <div className="score-hover" style={box(place(hover.bbox, hover.system), zoom)} />}
    </div>
  );
}

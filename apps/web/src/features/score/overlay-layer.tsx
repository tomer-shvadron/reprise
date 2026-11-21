import { anchorBox, type Anchor, type LayoutResult, type Range, type Rect } from '@reprise/layout';
import type { CSSProperties } from 'react';

/** A box in layout space, already shifted for its system; drawn only while that system is mounted. */
export interface OverlayBox {
  system: number;
  box: Rect;
  /** The cursor's other staff in `both` notation: drawn fainter than the one it sits on. */
  muted?: boolean;
}

export interface ScoreOverlays {
  selection?: readonly Anchor[];
  /** The edit cursor: a string box on a tab staff, a column on a staff. */
  caret?: readonly OverlayBox[];
  /** The edit range's boxes, one per system part and block of tracks. */
  range?: readonly OverlayBox[];
  /** The active loop's bar columns. */
  loop?: readonly Anchor[];
  /** The beats of the chord picked in the chord strip, one box per chord drawn. */
  chords?: readonly OverlayBox[];
  /** The one occurrence the strip's arrows are on, drawn stronger than the rest. */
  chordNow?: readonly OverlayBox[];
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
  const {
    selection = [],
    loop = [],
    hover,
    caret = [],
    range: editRange = [],
    chords = [],
    chordNow = [],
  } = overlays ?? {};
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
  const placed = (list: readonly OverlayBox[], className: string) =>
    list
      .filter((item) => item.system >= range.start && item.system < range.end)
      .map((item, index) => (
        <div
          key={`${className}-${String(index)}`}
          className={item.muted ? `${className} ${className}-muted` : className}
          style={box(item.box, zoom)}
        />
      ));
  return (
    <div className="score-overlays" aria-hidden="true">
      {boxes(loop, 'score-loop')}
      {boxes(selection, 'score-selection')}
      {placed(editRange, 'score-range')}
      {placed(chords, 'score-chord')}
      {placed(chordNow, 'score-chord-now')}
      {placed(caret, 'score-caret')}
      {hover && <div className="score-hover" style={box(anchorBox(layout, hover), zoom)} />}
    </div>
  );
}

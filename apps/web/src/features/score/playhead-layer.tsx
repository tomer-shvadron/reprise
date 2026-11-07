import { memo, type RefObject } from 'react';

export interface PlayheadLayerProps {
  bar: RefObject<HTMLDivElement | null>;
  line: RefObject<HTMLDivElement | null>;
}

/**
 * The playhead's two boxes, which `ScoreViewHandle.setPlayhead` moves by writing their styles.
 * None carries a React-managed `style`, so a re-render of the view never overwrites them.
 */
export const PlayheadLayer = memo(function PlayheadLayer({ bar, line }: PlayheadLayerProps) {
  return (
    <div className="score-overlays score-playhead" aria-hidden="true" data-playhead="">
      <div ref={bar} className="score-bar-highlight" />
      <div ref={line} className="score-cursor" />
    </div>
  );
});

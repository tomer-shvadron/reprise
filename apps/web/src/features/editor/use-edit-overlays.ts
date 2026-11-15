import { useMemo } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import type { ScoreOverlays } from '@/features/score';

import { caretBoxes, rangeBoxes } from './geometry';
import { visibleTracks } from './visible';

/**
 * The caret and range boxes for the open score's layout. The caret is drawn only while editing;
 * the range in both modes, since the transport's bar selection shares it. Memoised, so a
 * pointer move that changes nothing in the store allocates nothing.
 */
export function useEditOverlays(): Pick<ScoreOverlays, 'caret' | 'range'> {
  const { document, layout, selection, editing } = useAppServices();
  const score = useStore(document, (state) => state.score);
  const view = useStore(document, (state) => state.view);
  const result = useStore(layout, (state) => state.result);
  const cursor = useStore(selection, (state) => state.cursor);
  const range = useStore(selection, (state) => state.range);
  const isEditing = useStore(editing, (state) => state.editing);

  return useMemo(() => {
    if (!score || !result) return {};
    const visible = visibleTracks(score, view);
    return {
      ...(isEditing && cursor && { caret: caretBoxes(result, score, cursor) }),
      ...(range && { range: rangeBoxes(result, score, range, visible) }),
    };
  }, [score, view, result, cursor, range, isEditing]);
}

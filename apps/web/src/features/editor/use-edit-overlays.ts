import { useMemo } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import type { AppServices } from '@/app/services';
import type { ScoreOverlays } from '@/features/score';

import { caretBoxes, rangeBoxes } from './geometry';
import { visibleTracks } from './visible';

/**
 * The caret and range boxes for the open score's layout. The caret is drawn only while editing;
 * the range in both modes, since the transport's bar selection shares it. Memoised, so a
 * pointer move that changes nothing in the store allocates nothing.
 */
export function useEditOverlays(): Pick<ScoreOverlays, 'caret' | 'range'> {
  return useEditOverlaysFor(useAppServices());
}

/** `useEditOverlays` over given stores, for the demo, which has no app services. */
export function useEditOverlaysFor(
  stores: Pick<AppServices, 'document' | 'layout' | 'selection' | 'editing'>,
): Pick<ScoreOverlays, 'caret' | 'range'> {
  const { document, layout, selection, editing } = stores;
  const score = useStore(document, (state) => state.score);
  const view = useStore(document, (state) => state.view);
  const result = useStore(layout, (state) => state.result);
  const cursor = useStore(selection, (state) => state.cursor);
  const range = useStore(selection, (state) => state.range);
  const isEditing = useStore(editing, (state) => state.editing);

  // One memo per overlay, so a cursor move never rebuilds the range boxes nor the reverse.
  const caret = useMemo(
    () => (score && result && isEditing && cursor ? caretBoxes(result, score, cursor) : undefined),
    [score, result, cursor, isEditing],
  );
  const boxes = useMemo(
    () =>
      score && result && range
        ? rangeBoxes(result, score, range, visibleTracks(score, view))
        : undefined,
    [score, view, result, range],
  );
  return useMemo(
    () => ({ ...(caret && { caret }), ...(boxes && { range: boxes }) }),
    [caret, boxes],
  );
}

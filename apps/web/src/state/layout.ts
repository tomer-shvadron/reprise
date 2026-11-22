import {
  layout as layoutScore,
  LayoutCache,
  VERTICAL_EDIT_REACH,
  VERTICAL_FOLLOW_UP_REACH,
  type LayoutOptions,
  type LayoutResult,
} from '@reprise/layout';
import type { Id } from '@reprise/model';
import { create } from 'zustand';

import type { DocumentStore, DocumentView } from './document';
import type { UiStore, UiView } from './ui';

export interface LayoutStoreState {
  documentId: Id | undefined;
  result: LayoutResult | undefined;
  /** Why the open score could not be laid out; the document stays open and playable. */
  error: string | undefined;
}

export interface LayoutStoreDeps {
  document: DocumentStore;
  ui: UiStore;
  options: (view: UiView, content: DocumentView) => LayoutOptions;
  layout?: typeof layoutScore;
  /** Another input of `options` (a setting): subscribe to it, and a change re-lays out. */
  watch?: (rerun: () => void) => () => void;
}

/**
 * One frame between follow-up calls: each is a full cached layout (about 5 ms on the long score),
 * and spacing them keeps input and painting served between them.
 */
export const FOLLOW_UP_DELAY_MS = 16;

/**
 * The layout of the open document, derived outside render. It re-runs only when the document,
 * its score, its view, the ui's view (mode, paper) or a watched setting changes; zoom, theme and panels never do.
 * An edit hands its touched bars to the same cache, so only they re-flow.
 *
 * In continuous mode an edit that changes the shared vertical layout redraws only the segments
 * nearest it at once (`verticalReach`, #229); the store then catches the rest up in follow-up calls,
 * one per frame, until none is stale. A new run, a switch of document and `dispose` cancel the
 * pending one, and a full run (document, view or setting change) is exact and synchronous.
 */
export function createLayoutStore(deps: LayoutStoreDeps) {
  const { document, ui, options, layout = layoutScore, watch } = deps;
  const store = create<LayoutStoreState>()(() => ({
    documentId: undefined,
    result: undefined,
    error: undefined,
  }));
  let cache: LayoutCache | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;

  const cancelFollowUp = () => {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
  };

  /** Redraws the next stale segments, then schedules the next call if any is left. */
  const followUp = (id: Id | undefined, scoreAtSchedule: unknown) => {
    pending = undefined;
    const { score, view } = document.getState();
    if (!score || !cache || id !== document.getState().id || score !== scoreAtSchedule) return;
    try {
      const base = options(ui.getState().view, view);
      const result = layout(score, { ...base, verticalReach: VERTICAL_FOLLOW_UP_REACH }, cache);
      store.setState({ documentId: id, result, error: undefined });
      scheduleFollowUp(id, score, result);
    } catch (error) {
      console.error(error);
      cache = undefined;
      store.setState({
        documentId: id,
        result: undefined,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const scheduleFollowUp = (id: Id | undefined, score: unknown, result: LayoutResult) => {
    if (result.metrics.staleSystems === 0) return;
    pending = setTimeout(() => {
      followUp(id, score);
    }, FOLLOW_UP_DELAY_MS);
  };

  const run = (dirtyBars?: readonly Id[], edit = false) => {
    cancelFollowUp();
    const { id, score, view } = document.getState();
    if (!score) {
      cache = undefined;
      store.setState({ documentId: undefined, result: undefined, error: undefined });
      return;
    }
    cache ??= new LayoutCache();
    const base = options(ui.getState().view, view);
    try {
      const deferred = edit && base.mode === 'continuous';
      const result = layout(
        score,
        {
          ...base,
          ...(dirtyBars && { dirtyBars }),
          ...(deferred && { verticalReach: VERTICAL_EDIT_REACH }),
        },
        cache,
      );
      store.setState({ documentId: id, result, error: undefined });
      scheduleFollowUp(id, score, result);
    } catch (error) {
      console.error(error);
      cache = undefined;
      store.setState({
        documentId: id,
        result: undefined,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const unsubscribeDocument = document.subscribe((state, previous) => {
    if (state.id !== previous.id) {
      cache = undefined;
      run();
    } else if (state.score !== previous.score) {
      run(state.lastChange?.touchedBars, true);
    } else if (state.view !== previous.view) {
      run();
    }
  });
  const unsubscribeUi = ui.subscribe((state, previous) => {
    if (state.view !== previous.view) run();
  });
  const unsubscribeWatch = watch?.(() => {
    run();
  });
  run();

  return Object.assign(store, {
    dispose() {
      cancelFollowUp();
      unsubscribeDocument();
      unsubscribeUi();
      unsubscribeWatch?.();
    },
  });
}

export type LayoutStore = ReturnType<typeof createLayoutStore>;

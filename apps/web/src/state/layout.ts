import {
  layout as layoutScore,
  LayoutCache,
  VERTICAL_EDIT_REACH,
  VERTICAL_FOLLOW_UP_REACH,
  type LayoutOptions,
  type LayoutResult,
  type Range,
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
  /** The segments the view has mounted (indices into the shown result's systems), when there is one. */
  visible?: () => Range | undefined;
  /** Another input of `options` (a setting): subscribe to it, and a change re-lays out. */
  watch?: (rerun: () => void) => () => void;
}

/**
 * The fallback gap between follow-up calls where `requestIdleCallback` is missing (jsdom, and the
 * unit tests' fake timers): one frame.
 */
export const FOLLOW_UP_DELAY_MS = 16;

/** The longest a follow-up waits for an idle period under load, so convergence stays bounded. */
export const FOLLOW_UP_IDLE_TIMEOUT_MS = 50;

type Cancel = () => void;

/** Runs `task` in an idle period (a frame's spare time), or after a frame where there is none. */
function whenIdle(task: () => void): Cancel {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(task, { timeout: FOLLOW_UP_IDLE_TIMEOUT_MS });
    return () => {
      cancelIdleCallback(handle);
    };
  }
  const handle = setTimeout(task, FOLLOW_UP_DELAY_MS);
  return () => {
    clearTimeout(handle);
  };
}

/**
 * The layout of the open document, derived outside render. It re-runs only when the document,
 * its score, its view, the ui's view (mode, paper) or a watched setting changes; zoom, theme and panels never do.
 * An edit hands its touched bars to the same cache, so only they re-flow.
 *
 * In continuous mode an edit that changes the shared vertical layout redraws at once the segments
 * on screen (`visible`, the view's mounted range) and the ones nearest the edit (`verticalReach`,
 * #229). The store then catches the rest up in follow-up calls, one per idle period, without
 * publishing them: what they redraw is off screen, and the cache already holds it. It publishes
 * once, when none is stale. A new run, a switch of document and `dispose` cancel the pending call
 * (every change of the score, the id or the view goes through `run`), and a full run (document,
 * view or setting change) is exact and synchronous.
 */
export function createLayoutStore(deps: LayoutStoreDeps) {
  const { document, ui, options, layout = layoutScore, watch, visible } = deps;
  const store = create<LayoutStoreState>()(() => ({
    documentId: undefined,
    result: undefined,
    error: undefined,
  }));
  let cache: LayoutCache | undefined;
  let cancelPending: Cancel | undefined;

  const cancelFollowUp = () => {
    cancelPending?.();
    cancelPending = undefined;
  };

  const fail = (id: Id | undefined, error: unknown) => {
    console.error(error);
    cache = undefined;
    store.setState({
      documentId: id,
      result: undefined,
      error: error instanceof Error ? error.message : String(error),
    });
  };

  /** Redraws the next stale segments, and publishes only when none is left. */
  const followUp = () => {
    cancelPending = undefined;
    const { id, score, view } = document.getState();
    if (!score || !cache) return;
    try {
      const base = options(ui.getState().view, view);
      const result = layout(score, { ...base, verticalReach: VERTICAL_FOLLOW_UP_REACH }, cache);
      if (result.metrics.staleSystems === 0) {
        store.setState({ documentId: id, result, error: undefined });
      } else {
        cancelPending = whenIdle(followUp);
      }
    } catch (error) {
      fail(id, error);
    }
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
          ...(deferred && { verticalReach: VERTICAL_EDIT_REACH, verticalWindow: visible?.() }),
        },
        cache,
      );
      store.setState({ documentId: id, result, error: undefined });
      if (result.metrics.staleSystems > 0) cancelPending = whenIdle(followUp);
    } catch (error) {
      fail(id, error);
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

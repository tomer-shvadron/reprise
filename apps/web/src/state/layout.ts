import {
  layout as layoutScore,
  LayoutCache,
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
}

/**
 * The layout of the open document, derived outside render. It re-runs only when the document,
 * its score, its view or the ui's view (mode, paper) changes; zoom, theme and panels never do.
 * An edit hands its touched bars to the same cache, so only they re-flow.
 */
export function createLayoutStore(deps: LayoutStoreDeps) {
  const { document, ui, options, layout = layoutScore } = deps;
  const store = create<LayoutStoreState>()(() => ({
    documentId: undefined,
    result: undefined,
    error: undefined,
  }));
  let cache: LayoutCache | undefined;

  const run = (dirtyBars?: readonly Id[]) => {
    const { id, score, view } = document.getState();
    if (!score) {
      cache = undefined;
      store.setState({ documentId: undefined, result: undefined, error: undefined });
      return;
    }
    cache ??= new LayoutCache();
    const base = options(ui.getState().view, view);
    try {
      const result = layout(score, dirtyBars ? { ...base, dirtyBars } : base, cache);
      store.setState({ documentId: id, result, error: undefined });
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
      run(state.lastChange?.touchedBars);
    } else if (state.view !== previous.view) {
      run();
    }
  });
  const unsubscribeUi = ui.subscribe((state, previous) => {
    if (state.view !== previous.view) run();
  });
  run();

  return Object.assign(store, {
    dispose() {
      unsubscribeDocument();
      unsubscribeUi();
    },
  });
}

export type LayoutStore = ReturnType<typeof createLayoutStore>;

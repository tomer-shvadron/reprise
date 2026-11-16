import type { HistoryMenuLabels, Platform } from '@/platform/platform';

import type { DocumentStore } from './document';

/**
 * Keeps the native Edit menu's Undo and Redo labels in step with the document's history. Pushes
 * only when the newest label on a stack changes (an edit deeper in the stacks is no news), and
 * does nothing on a platform without a menu, such as the web build. Returns the undo.
 */
export function installHistoryMenu(
  document: DocumentStore,
  platform: Pick<Platform, 'setHistoryLabels'>,
): () => void {
  const { setHistoryLabels } = platform;
  if (!setHistoryLabels) return () => undefined;
  const labelsOf = (): HistoryMenuLabels => {
    const { undo, redo } = document.getState().historyLabels;
    return {
      ...(undo[0] !== undefined && { undo: undo[0] }),
      ...(redo[0] !== undefined && { redo: redo[0] }),
    };
  };
  // Nothing sent yet, so the first push always goes: it tells main the stacks are empty.
  let last = '';
  const push = () => {
    const labels = labelsOf();
    const key = JSON.stringify(labels);
    if (key === last) return;
    last = key;
    setHistoryLabels.call(platform, labels);
  };
  let labels = document.getState().historyLabels;
  push();
  return document.subscribe((state) => {
    if (state.historyLabels === labels) return;
    labels = state.historyLabels;
    push();
  });
}

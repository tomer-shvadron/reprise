import type { AppServices } from '@/app/services';

export const TRACK_LIST_ATTR = 'data-track-list';
export const TRACK_SELECT_ATTR = 'data-track-select';

function focusSelector(selector: string): boolean {
  const element = document.querySelector<HTMLElement>(selector);
  element?.focus();
  return element !== null && document.activeElement === element;
}

/**
 * One key to leave the score for the tracks list (on the current track's row) and to come back.
 * A collapsed sidebar is opened first; its rows exist a frame later.
 */
export function toggleSidebarFocus(services: Pick<AppServices, 'selection' | 'ui'>): void {
  const active = document.activeElement;
  if (active?.closest(`[${TRACK_LIST_ATTR}]`)) {
    focusSelector('[data-score-view]');
    return;
  }
  const focusRow = () => {
    const current = services.selection.getState().currentTrack;
    if (current !== undefined && focusSelector(`[${TRACK_SELECT_ATTR}="${CSS.escape(current)}"]`)) {
      return;
    }
    focusSelector(`[${TRACK_SELECT_ATTR}]`);
  };
  const { ui } = services;
  if (!ui.getState().panels.sidebar) {
    ui.getState().togglePanel('sidebar');
    // The store update re-renders synchronously; the frame only waits for the rows to be in the DOM.
    requestAnimationFrame(focusRow);
    return;
  }
  focusRow();
}

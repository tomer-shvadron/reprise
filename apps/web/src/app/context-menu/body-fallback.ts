import { useEffect } from 'react';

import { contextMenuVia, openContextMenuOn, raisedByUs, SCORE_SURFACE_SELECTOR } from './open-on';

/**
 * Answers the Menu key (and Shift+F10 on Windows and Linux) while nothing has focus, where
 * Chromium raises its keyboard `contextmenu` event at whatever lies under the window's corner (the
 * header, in the app) or at the body, and no surface asked for it: the score's menu opens
 * instead, as it does for the mac command. It listens in the capture phase to run before that
 * element's own handler, and takes only a keyboard event raised with the page itself focused, so
 * a pointer's right-click, a focused control and the events the app raises itself are left alone.
 */
export function useBodyContextMenuFallback(): void {
  useEffect(() => {
    const doc = globalThis.document;
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || raisedByUs(event)) return;
      if (doc.activeElement && doc.activeElement !== doc.body) return;
      if (contextMenuVia(event) !== 'keyboard') return;
      const surface = doc.querySelector(SCORE_SURFACE_SELECTOR);
      if (!surface) return;
      // Only when the score answers does this event end here; else it goes on to what is under
      // the corner (in edit mode, which has no score menu yet, that is the browser's).
      if (!openContextMenuOn(surface)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    doc.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      doc.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, []);
}

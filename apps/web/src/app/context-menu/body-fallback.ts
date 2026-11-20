import { useEffect } from 'react';

import { contextMenuVia, openContextMenuOn, SCORE_SURFACE_SELECTOR } from './open-on';

/**
 * Answers the Menu key (and Shift+F10 on Windows and Linux) while focus is on the page itself,
 * where Chromium raises its keyboard `contextmenu` event on the body and no surface hears it: the
 * score's menu opens, as it does for the mac command. Only a keyboard event aimed at the body or
 * the root element, so a pointer's right-click, a focused control and any surface's own handler
 * are left alone.
 */
export function useBodyContextMenuFallback(): void {
  useEffect(() => {
    const doc = globalThis.document;
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.target !== doc.body && event.target !== doc.documentElement) return;
      if (contextMenuVia(event) !== 'keyboard') return;
      const surface = doc.querySelector(SCORE_SURFACE_SELECTOR);
      if (!surface) return;
      event.preventDefault();
      openContextMenuOn(surface);
    };
    doc.addEventListener('contextmenu', onContextMenu);
    return () => {
      doc.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);
}

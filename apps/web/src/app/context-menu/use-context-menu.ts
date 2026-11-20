import type { MouseEvent as ReactMouseEvent } from 'react';

import { useAppServices } from '../services-context';
import { isEditable } from '../text-field';
import { contextMenuVia } from './open-on';
import type { MenuRequest } from './types';

/** Decides what a `contextmenu` event on a surface opens; `undefined` lets it bubble to an outer surface. */
export type ResolveMenuRequest = (
  via: 'pointer' | 'keyboard',
  event: ReactMouseEvent,
) => MenuRequest | undefined;

/**
 * The handler a surface spreads on its root element (`<li {...menu}>`). A keyboard open from any
 * focused control inside the surface bubbles there. A text field keeps the browser's own menu,
 * and the surface's own request is checked before the event is taken, so an unresolved one
 * bubbles on.
 */
export function useContextMenu(resolve: ResolveMenuRequest): {
  onContextMenu: (event: ReactMouseEvent) => void;
} {
  const { contextMenu } = useAppServices();
  return {
    onContextMenu: (event) => {
      if (event.defaultPrevented || isEditable(event.target)) return;
      // React bubbles a portaled child's event through the React tree: a right-click inside an
      // open dropdown under this surface is not a click on the surface.
      if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
      const via = contextMenuVia(event.nativeEvent);
      const request = resolve(via, event);
      if (!request) return;
      event.preventDefault();
      event.stopPropagation();
      let point = { x: event.clientX, y: event.clientY };
      if (via === 'keyboard') {
        const active = globalThis.document.activeElement;
        const at =
          request.anchor ??
          (active && event.currentTarget.contains(active)
            ? active
            : event.currentTarget
          ).getBoundingClientRect();
        point = { x: at.left, y: at.bottom };
      }
      contextMenu.getState().show(request, via, point);
    },
  };
}

/** A surface whose menu never depends on where inside it the click landed. */
export function useStaticContextMenu(request: MenuRequest): {
  onContextMenu: (event: ReactMouseEvent) => void;
} {
  return useContextMenu(() => request);
}

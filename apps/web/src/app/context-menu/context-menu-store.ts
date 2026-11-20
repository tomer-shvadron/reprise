import { create } from 'zustand';

import type { MenuTargetStore } from '@/state/menu-target';

import type { MenuRequest } from './types';

export type MenuVia = 'pointer' | 'keyboard';

export interface ContextMenuState {
  open: boolean;
  /** The last request, kept while the menu animates closed so its items do not vanish early. */
  request: MenuRequest | undefined;
  via: MenuVia;
  /** Where the menu opens, in client coordinates. */
  point: { x: number; y: number };
  /** What gets focus back when the menu closes. */
  invoker: Element | null;
  /** The element focused before the latest press, read before the browser moves focus. */
  pressedFrom: Element | null;
  show(request: MenuRequest, via: MenuVia, point: { x: number; y: number }): void;
  hide(): void;
  rememberPress(from: Element | null): void;
  /** Hands over the element to restore focus to, once. */
  takeInvoker(): Element | null;
}

/**
 * The open context menu. `show` writes what was clicked into the menu-target store and records
 * what to give focus back to: for a keyboard open the focused element, for a pointer open the
 * element focused before the press.
 */
export function createContextMenuStore(deps: { menuTarget: MenuTargetStore }) {
  return create<ContextMenuState>()((set, get) => ({
    open: false,
    request: undefined,
    via: 'pointer',
    point: { x: 0, y: 0 },
    invoker: null,
    pressedFrom: null,
    show(request, via, point) {
      const active = globalThis.document.activeElement;
      const invoker = via === 'keyboard' ? active : (get().pressedFrom ?? active);
      deps.menuTarget.getState().set(request.target);
      set({ open: true, request, via, point, invoker, pressedFrom: null });
    },
    hide() {
      set({ open: false });
    },
    rememberPress(from) {
      set({ pressedFrom: from });
    },
    takeInvoker() {
      const { invoker } = get();
      set({ invoker: null });
      return invoker;
    },
  }));
}

export type ContextMenuStore = ReturnType<typeof createContextMenuStore>;

import type { LayoutOptions, PAGE_SIZES } from '@reprise/layout';
import { create } from 'zustand';

import { initialTheme, writeStoredTheme, type Theme } from './theme';

export type PanelId = 'sidebar' | 'rightPanel';

export const PANEL_WIDTH = {
  sidebar: { default: 240, min: 180, max: 400 },
  rightPanel: { default: 320, min: 240, max: 480 },
} as const satisfies Record<PanelId, { default: number; min: number; max: number }>;

export const ZOOM = { min: 0.5, max: 3, default: 1 } as const;

/** The score's view mode and paper; what layout reads from the ui. */
export interface UiView {
  mode: LayoutOptions['mode'];
  paper: keyof typeof PAGE_SIZES;
}

/** Whether the view follows the playhead; a new `request` asks for one follow even while stopped. */
export interface UiFollow {
  on: boolean;
  request: number;
}

export interface UiState {
  theme: Theme;
  view: UiView;
  panels: Record<PanelId, boolean>;
  panelWidths: Record<PanelId, number>;
  zoom: number;
  paletteOpen: boolean;
  follow: UiFollow;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setPanelOpen: (panel: PanelId, open: boolean) => void;
  togglePanel: (panel: PanelId) => void;
  setPanelWidth: (panel: PanelId, width: number) => void;
  setZoom: (zoom: number) => void;
  setPaletteOpen: (open: boolean) => void;
  setViewMode: (mode: UiView['mode']) => void;
  setPaper: (paper: UiView['paper']) => void;
  /** Turns following on and asks for one follow now. */
  requestFollow: () => void;
  /** A hand scroll along the followed axis: the view stops following until a request. */
  pauseFollow: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function createUiStore(theme: Theme = initialTheme()) {
  return create<UiState>()((set, get) => ({
    theme,
    view: { mode: 'paged', paper: 'a4' },
    panels: { sidebar: true, rightPanel: false },
    panelWidths: {
      sidebar: PANEL_WIDTH.sidebar.default,
      rightPanel: PANEL_WIDTH.rightPanel.default,
    },
    zoom: ZOOM.default,
    paletteOpen: false,
    follow: { on: true, request: 0 },
    setTheme: (next) => {
      writeStoredTheme(next);
      set({ theme: next });
    },
    toggleTheme: () => {
      get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
    },
    setPanelOpen: (panel, open) => {
      set((state) => ({ panels: { ...state.panels, [panel]: open } }));
    },
    togglePanel: (panel) => {
      set((state) => ({ panels: { ...state.panels, [panel]: !state.panels[panel] } }));
    },
    setPanelWidth: (panel, width) => {
      const { min, max } = PANEL_WIDTH[panel];
      set((state) => ({ panelWidths: { ...state.panelWidths, [panel]: clamp(width, min, max) } }));
    },
    setZoom: (zoom) => {
      set({ zoom: clamp(zoom, ZOOM.min, ZOOM.max) });
    },
    setPaletteOpen: (open) => {
      set({ paletteOpen: open });
    },
    setViewMode: (mode) => {
      if (get().view.mode !== mode) set((state) => ({ view: { ...state.view, mode } }));
    },
    setPaper: (paper) => {
      if (get().view.paper !== paper) set((state) => ({ view: { ...state.view, paper } }));
    },
    requestFollow: () => {
      set((state) => ({ follow: { on: true, request: state.follow.request + 1 } }));
    },
    pauseFollow: () => {
      if (get().follow.on) set((state) => ({ follow: { ...state.follow, on: false } }));
    },
  }));
}

export type UiStore = ReturnType<typeof createUiStore>;

export const useUiStore = createUiStore();

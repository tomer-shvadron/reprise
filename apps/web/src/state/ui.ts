import { create } from 'zustand';

import { initialTheme, writeStoredTheme, type Theme } from './theme';

export type PanelId = 'sidebar' | 'rightPanel';

export const PANEL_WIDTH = {
  sidebar: { default: 240, min: 180, max: 400 },
  rightPanel: { default: 320, min: 240, max: 480 },
} as const satisfies Record<PanelId, { default: number; min: number; max: number }>;

export const ZOOM = { min: 0.5, max: 3, default: 1 } as const;

export interface UiState {
  theme: Theme;
  panels: Record<PanelId, boolean>;
  panelWidths: Record<PanelId, number>;
  zoom: number;
  paletteOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setPanelOpen: (panel: PanelId, open: boolean) => void;
  togglePanel: (panel: PanelId) => void;
  setPanelWidth: (panel: PanelId, width: number) => void;
  setZoom: (zoom: number) => void;
  setPaletteOpen: (open: boolean) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function createUiStore(theme: Theme = initialTheme()) {
  return create<UiState>()((set, get) => ({
    theme,
    panels: { sidebar: true, rightPanel: false },
    panelWidths: {
      sidebar: PANEL_WIDTH.sidebar.default,
      rightPanel: PANEL_WIDTH.rightPanel.default,
    },
    zoom: ZOOM.default,
    paletteOpen: false,
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
  }));
}

export type UiStore = ReturnType<typeof createUiStore>;

export const useUiStore = createUiStore();

import type { LayoutOptions, PAGE_SIZES } from '@reprise/layout';
import { create } from 'zustand';

import {
  BOTTOM_PANEL_HEIGHT,
  readStoredBottomPanelHeight,
  writeStoredBottomPanelHeight,
} from './bottom-panel-storage';
import { PANEL_WIDTH } from './panel-width';
import { initialTheme, type Theme } from './theme';

export { BOTTOM_PANEL_HEIGHT };

export type PanelId = 'sidebar' | 'rightPanel';

export { PANEL_WIDTH };

export const ZOOM = { min: 0.5, max: 3, default: 1 } as const;

/**
 * What fills the app besides the player. The library (WP-060) and the sound manager (WP-091) are
 * full-window screens over the score; `player` is the score itself.
 */
export type ScreenId = 'player' | 'library' | 'sounds';

/**
 * What the right panel shows; the mixer is the default and the trainer tools and the effects
 * palette (WP-082) and the history panel (WP-084) take turns with it.
 */
export type PanelView = 'mixer' | 'speedTrainer' | 'tuner' | 'metronome' | 'effects' | 'history';

/** What the bottom region shows, one view at a time; the live fretboard (WP-074) is the first. */
export type BottomPanelView = 'fretboard';

/** The region's accessible name and header, per view. */
export const BOTTOM_PANEL_TITLES: Record<BottomPanelView, string> = { fretboard: 'Fretboard' };

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
  screen: ScreenId;
  rightPanelView: PanelView;
  panelWidths: Record<PanelId, number>;
  /** The right panel is open because the stored state said so, not because the user opened it. */
  panelRestored: boolean;
  /** The bottom region (#206): above the transport, below the score. Only the height persists. */
  bottomPanel: { open: boolean; view: BottomPanelView };
  bottomPanelHeight: number;
  zoom: number;
  paletteOpen: boolean;
  follow: UiFollow;
  /** The theme on screen; the choice is the `appearance.theme` setting, which `installTheme` applies here. */
  setTheme: (theme: Theme) => void;
  setPanelOpen: (panel: PanelId, open: boolean) => void;
  togglePanel: (panel: PanelId) => void;
  /** Closes the right panel when it shows the mixer; otherwise shows the mixer there, opening it. */
  toggleMixer: () => void;
  /** Applies the stored open state of the right panel at launch, which takes no focus. */
  restoreRightPanelOpen: (open: boolean) => void;
  setScreen: (screen: ScreenId) => void;
  /** Shows `view` in the right panel and opens the panel. */
  showPanelView: (view: PanelView) => void;
  setPanelWidth: (panel: PanelId, width: number) => void;
  /** Shows `view` in the bottom region and opens it. */
  showBottomPanelView: (view: BottomPanelView) => void;
  /** Closes the bottom region when it shows `view`; otherwise shows `view` there, opening it. */
  toggleBottomPanelView: (view: BottomPanelView) => void;
  /** Collapses or expands the bottom region, keeping its view. */
  setBottomPanelOpen: (open: boolean) => void;
  /** Clamped to `BOTTOM_PANEL_HEIGHT`; not stored until `persistBottomPanelHeight`. */
  setBottomPanelHeight: (height: number) => void;
  /** Stores the height for the next session; call when a resize ends, not on every step. */
  persistBottomPanelHeight: () => void;
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

/**
 * The score's viewport changes with the bottom region, and a size change alone does not move the
 * playhead back into view, so ask for one follow; only while following, so a hand scroll's pause
 * stands (`requestFollow` itself turns following on).
 */
function followAfterResize(get: () => UiState) {
  if (get().follow.on) get().requestFollow();
}

export function createUiStore(theme: Theme = initialTheme()) {
  return create<UiState>()((set, get) => ({
    theme,
    view: { mode: 'paged', paper: 'a4' },
    panels: { sidebar: true, rightPanel: false },
    screen: 'player',
    panelRestored: false,
    rightPanelView: 'mixer',
    panelWidths: {
      sidebar: PANEL_WIDTH.sidebar.default,
      rightPanel: PANEL_WIDTH.rightPanel.default,
    },
    bottomPanel: { open: false, view: 'fretboard' },
    bottomPanelHeight: readStoredBottomPanelHeight(),
    zoom: ZOOM.default,
    paletteOpen: false,
    follow: { on: true, request: 0 },
    setTheme: (next) => {
      set({ theme: next });
    },
    setPanelOpen: (panel, open) => {
      set((state) => ({ panels: { ...state.panels, [panel]: open }, panelRestored: false }));
    },
    togglePanel: (panel) => {
      set((state) => ({
        panels: { ...state.panels, [panel]: !state.panels[panel] },
        panelRestored: false,
      }));
    },
    toggleMixer: () => {
      const { panels, rightPanelView } = get();
      if (panels.rightPanel && rightPanelView === 'mixer') get().setPanelOpen('rightPanel', false);
      else get().showPanelView('mixer');
    },
    restoreRightPanelOpen: (open) => {
      set((state) => ({ panels: { ...state.panels, rightPanel: open }, panelRestored: open }));
    },
    setScreen: (screen) => {
      set({ screen });
    },
    showPanelView: (view) => {
      set((state) => ({
        rightPanelView: view,
        panels: { ...state.panels, rightPanel: true },
        panelRestored: false,
      }));
    },
    setPanelWidth: (panel, width) => {
      const { min, max } = PANEL_WIDTH[panel];
      set((state) => ({ panelWidths: { ...state.panelWidths, [panel]: clamp(width, min, max) } }));
    },
    showBottomPanelView: (view) => {
      set({ bottomPanel: { open: true, view } });
      followAfterResize(get);
    },
    toggleBottomPanelView: (view) => {
      const { open, view: shown } = get().bottomPanel;
      const showing: BottomPanelView | undefined = open ? shown : undefined;
      if (showing === view) get().setBottomPanelOpen(false);
      else get().showBottomPanelView(view);
    },
    setBottomPanelOpen: (open) => {
      set((state) => ({ bottomPanel: { ...state.bottomPanel, open } }));
      followAfterResize(get);
    },
    setBottomPanelHeight: (height) => {
      const { min, max } = BOTTOM_PANEL_HEIGHT;
      const next = clamp(Math.round(height), min, max);
      set({ bottomPanelHeight: next });
      followAfterResize(get);
    },
    persistBottomPanelHeight: () => {
      writeStoredBottomPanelHeight(get().bottomPanelHeight);
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

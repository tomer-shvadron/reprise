import type { LayoutOptions, PAGE_SIZES } from '@reprise/layout';
import { create } from 'zustand';

import { BOTTOM_PANEL_HEIGHT } from './bottom-panel-height';
import { PANEL_WIDTH } from './panel-width';
import { initialTheme, type Theme } from './theme';
import { ZOOM } from './zoom';

export { BOTTOM_PANEL_HEIGHT };

export type PanelId = 'sidebar' | 'rightPanel';

export { PANEL_WIDTH };

export { ZOOM };

/**
 * The sheets that open over the player (#342): the library (WP-060) and the sound manager
 * (WP-091). The player stays mounted behind them, dimmed.
 */
export type SheetId = 'library' | 'sounds';

/**
 * What the right panel shows; the mixer is the default and the trainer tools and the effects
 * palette (WP-082) and the history panel (WP-084) take turns with it.
 */
export type PanelView = 'mixer' | 'speedTrainer' | 'tuner' | 'metronome' | 'effects' | 'history';

/**
 * The bottom dock's views in tab order, one shown at a time; the live fretboard (WP-074) is the
 * first. A view that takes focus when it mounts (the Overview, a horizontal mixer) needs a
 * "restored at launch" flag, as the right panel has, so a dock restored open never grabs focus.
 */
export const BOTTOM_PANEL_VIEWS = ['fretboard'] as const;
export type BottomPanelView = (typeof BOTTOM_PANEL_VIEWS)[number];

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
  /**
   * Why the last request was made: `explicit` for the Follow playback command, a seek, the button;
   * `layout` for a resize of the score's viewport, which the follow-playhead setting can silence.
   */
  kind: 'explicit' | 'layout';
}

export interface UiState {
  theme: Theme;
  view: UiView;
  panels: Record<PanelId, boolean>;
  /** The sheet open over the player, if any; one at a time. */
  sheet: SheetId | undefined;
  rightPanelView: PanelView;
  panelWidths: Record<PanelId, number>;
  /** The right panel is open because the stored state said so, not because the user opened it. */
  panelRestored: boolean;
  /**
   * The bottom dock: above the transport, below the score. `open` is whether it shows its view or
   * is collapsed to its tab strip; `installBottomDock` keeps `open` and the height in settings.
   */
  bottomPanel: { open: boolean; view: BottomPanelView };
  bottomPanelHeight: number;
  /** The height last committed by `persistBottomPanelHeight`, which is what gets stored. */
  bottomPanelHeightCommitted: number;
  zoom: number;
  paletteOpen: boolean;
  /** The Settings dialog; `section` is the id `openSettings` asked for, absent for the last one shown. */
  settings: { open: boolean; section: string | undefined };
  /** The shortcuts cheat sheet (WP-101). */
  shortcutsOpen: boolean;
  follow: UiFollow;
  /** The theme on screen; the choice is the `appearance.theme` setting, which `installTheme` applies here. */
  setTheme: (theme: Theme) => void;
  setPanelOpen: (panel: PanelId, open: boolean) => void;
  togglePanel: (panel: PanelId) => void;
  /** Closes the right panel when it shows the mixer; otherwise shows the mixer there, opening it. */
  toggleMixer: () => void;
  /** Applies the stored open state of the right panel at launch, which takes no focus. */
  restoreRightPanelOpen: (open: boolean) => void;
  /** Opens `sheet`, swapping out the one that is open. */
  showSheet: (sheet: SheetId) => void;
  closeSheet: () => void;
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
  /** Commits the height for storing; call when a resize ends, not on every step. */
  persistBottomPanelHeight: () => void;
  setZoom: (zoom: number) => void;
  setPaletteOpen: (open: boolean) => void;
  /** Opens Settings at `section` (an id from `app/settings-sections.ts`); an unknown id shows the first. */
  openSettings: (section?: string) => void;
  closeSettings: () => void;
  setShortcutsOpen: (open: boolean) => void;
  setViewMode: (mode: UiView['mode']) => void;
  setPaper: (paper: UiView['paper']) => void;
  /** Turns following on and asks for one follow now. */
  requestFollow: (kind?: UiFollow['kind']) => void;
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
  if (get().follow.on) get().requestFollow('layout');
}

export function createUiStore(theme: Theme = initialTheme()) {
  return create<UiState>()((set, get) => ({
    theme,
    view: { mode: 'paged', paper: 'a4' },
    panels: { sidebar: true, rightPanel: false },
    sheet: undefined,
    panelRestored: false,
    rightPanelView: 'mixer',
    panelWidths: {
      sidebar: PANEL_WIDTH.sidebar.default,
      rightPanel: PANEL_WIDTH.rightPanel.default,
    },
    bottomPanel: { open: false, view: 'fretboard' },
    bottomPanelHeight: BOTTOM_PANEL_HEIGHT.default,
    bottomPanelHeightCommitted: BOTTOM_PANEL_HEIGHT.default,
    zoom: ZOOM.default,
    paletteOpen: false,
    settings: { open: false, section: undefined },
    shortcutsOpen: false,
    follow: { on: true, request: 0, kind: 'explicit' },
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
    showSheet: (sheet) => {
      if (get().sheet !== sheet) set({ sheet });
    },
    closeSheet: () => {
      if (get().sheet !== undefined) set({ sheet: undefined });
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
      set({ bottomPanelHeightCommitted: get().bottomPanelHeight });
    },
    setZoom: (zoom) => {
      set({ zoom: clamp(zoom, ZOOM.min, ZOOM.max) });
    },
    setPaletteOpen: (open) => {
      set({ paletteOpen: open });
    },
    openSettings: (section) => {
      set({ settings: { open: true, section } });
    },
    closeSettings: () => {
      set((state) => ({ settings: { ...state.settings, open: false } }));
    },
    setShortcutsOpen: (open) => {
      set({ shortcutsOpen: open });
    },
    setViewMode: (mode) => {
      if (get().view.mode !== mode) set((state) => ({ view: { ...state.view, mode } }));
    },
    setPaper: (paper) => {
      if (get().view.paper !== paper) set((state) => ({ view: { ...state.view, paper } }));
    },
    requestFollow: (kind = 'explicit') => {
      set((state) => ({ follow: { on: true, request: state.follow.request + 1, kind } }));
    },
    pauseFollow: () => {
      if (get().follow.on) set((state) => ({ follow: { ...state.follow, on: false } }));
    },
  }));
}

export type UiStore = ReturnType<typeof createUiStore>;

export const useUiStore = createUiStore();

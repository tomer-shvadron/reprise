import { describe, expect, it, vi } from 'vitest';

import { stubMatchMedia } from '@/test/match-media';

import { THEME_STORAGE_KEY, initialTheme } from './theme';
import { createUiStore } from './ui';

describe('ui store theme', () => {
  it('starts from the stored choice, and setTheme changes only the screen', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(createUiStore().getState().theme).toBe('light');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    const store = createUiStore();
    store.getState().setTheme('light');

    expect(store.getState().theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('treats a stored system like nothing stored', () => {
    stubMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');

    expect(initialTheme()).toBe('light');
  });

  it('starts from the system preference when nothing is stored', () => {
    stubMatchMedia(true);

    expect(initialTheme()).toBe('light');
  });

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');

    expect(initialTheme()).toBe('dark');
  });

  it('defaults to dark and keeps working when storage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const store = createUiStore();
    expect(store.getState().theme).toBe('dark');
    store.getState().setTheme('light');
    expect(store.getState().theme).toBe('light');

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe('ui store panels and zoom', () => {
  it('toggles panels and clamps widths and zoom', () => {
    const store = createUiStore('dark');

    store.getState().togglePanel('rightPanel');
    store.getState().setPanelWidth('sidebar', 10_000);
    store.getState().setZoom(0.01);

    expect(store.getState().panels.rightPanel).toBe(true);
    expect(store.getState().panelWidths.sidebar).toBe(400);
    expect(store.getState().zoom).toBe(0.5);
  });
});

describe('the ui view', () => {
  it('defaults to paged A4 and replaces the view only on a change', () => {
    const store = createUiStore('dark');
    const initial = store.getState().view;
    expect(initial).toEqual({ mode: 'paged', paper: 'a4' });

    store.getState().setViewMode('paged');
    expect(store.getState().view).toBe(initial);

    store.getState().setViewMode('continuous');
    store.getState().setPaper('letter');
    expect(store.getState().view).toEqual({ mode: 'continuous', paper: 'letter' });
  });
});

describe('following the playhead', () => {
  it('is on by default, pauses, and comes back on with a new request', () => {
    const store = createUiStore('dark');
    expect(store.getState().follow).toMatchObject({ on: true, request: 0 });

    store.getState().pauseFollow();
    const paused = store.getState().follow;
    expect(paused).toMatchObject({ on: false, request: 0 });
    store.getState().pauseFollow();
    expect(store.getState().follow).toBe(paused);

    store.getState().requestFollow();
    store.getState().requestFollow();
    expect(store.getState().follow).toMatchObject({ on: true, request: 2 });
  });
});

describe('ui store sheets and panel views', () => {
  it('starts on the player with the mixer in the right panel', () => {
    const state = createUiStore('dark').getState();
    expect(state.sheet).toBeUndefined();
    expect(state.rightPanelView).toBe('mixer');
  });

  it('opens one sheet at a time, swaps it, and ignores a repeat', () => {
    const store = createUiStore('dark');
    store.getState().showSheet('library');
    expect(store.getState().sheet).toBe('library');
    const seen = vi.fn();
    const stop = store.subscribe(seen);
    store.getState().showSheet('library');
    expect(seen).not.toHaveBeenCalled();
    stop();
    store.getState().showSheet('sounds');
    expect(store.getState().sheet).toBe('sounds');
    store.getState().closeSheet();
    expect(store.getState().sheet).toBeUndefined();
  });

  it('shows a panel view and opens the right panel', () => {
    const store = createUiStore('dark');
    expect(store.getState().panels.rightPanel).toBe(false);
    store.getState().showPanelView('tuner');
    expect(store.getState().rightPanelView).toBe('tuner');
    expect(store.getState().panels.rightPanel).toBe(true);
  });

  it('shows the effects and history views in the right panel', () => {
    const store = createUiStore('dark');
    store.getState().showPanelView('effects');
    expect(store.getState().rightPanelView).toBe('effects');
    expect(store.getState().panels.rightPanel).toBe(true);
    store.getState().showPanelView('history');
    expect(store.getState().rightPanelView).toBe('history');
  });
});

describe('ui store settings dialog', () => {
  it('opens at a section, keeps the last one on close, and opens at none by default', () => {
    const store = createUiStore('dark');
    expect(store.getState().settings).toEqual({ open: false, section: undefined });

    store.getState().openSettings('playback');
    expect(store.getState().settings).toEqual({ open: true, section: 'playback' });

    store.getState().closeSettings();
    expect(store.getState().settings.open).toBe(false);

    store.getState().openSettings();
    expect(store.getState().settings).toEqual({ open: true, section: undefined });
  });
});

describe('follow requests from the bottom dock', () => {
  it('ask as layout for every open, close and resize, and as explicit otherwise', () => {
    const store = createUiStore('dark');
    const kind = () => store.getState().follow.kind;

    store.getState().showBottomPanelView('fretboard');
    expect(kind()).toBe('layout');
    store.getState().requestFollow();
    expect(kind()).toBe('explicit');
    store.getState().setBottomPanelHeight(300);
    expect(kind()).toBe('layout');
    store.getState().requestFollow();
    store.getState().setBottomPanelOpen(false);
    expect(kind()).toBe('layout');
    store.getState().requestFollow();
    store.getState().toggleBottomPanelView('fretboard');
    expect(kind()).toBe('layout');
  });
});

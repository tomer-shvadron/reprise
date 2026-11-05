import { describe, expect, it, vi } from 'vitest';

import { stubMatchMedia } from '@/test/match-media';

import { THEME_STORAGE_KEY, initialTheme } from './theme';
import { createUiStore } from './ui';

describe('ui store theme', () => {
  it('persists the theme and restores it in a new store', () => {
    const first = createUiStore();
    expect(first.getState().theme).toBe('dark');

    first.getState().setTheme('light');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(createUiStore().getState().theme).toBe('light');
  });

  it('toggles between dark and light', () => {
    const store = createUiStore('dark');

    store.getState().toggleTheme();
    expect(store.getState().theme).toBe('light');
    store.getState().toggleTheme();
    expect(store.getState().theme).toBe('dark');
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

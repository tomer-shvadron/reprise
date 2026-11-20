import { afterEach, describe, expect, it, vi } from 'vitest';

import { THEME_SETTING } from '@/state/app-settings';
import { createUiStore } from '@/state/ui';
import { createTestSettings } from '@/test/settings-backend';

import { installTheme } from './install-theme';

/** A `matchMedia` whose answer a test can change, firing the `change` listeners. */
function fakeMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installTheme', () => {
  it('follows the system under system, and a live change of it', () => {
    const media = fakeMedia(true);
    const settings = createTestSettings();
    const ui = createUiStore('dark');
    const stop = installTheme({ settings, ui });

    expect(ui.getState().theme).toBe('light');
    media.set(false);
    expect(ui.getState().theme).toBe('dark');
    stop();
    expect(media.listeners.size).toBe(0);
  });

  it('ignores a system change under an explicit choice', () => {
    const media = fakeMedia(false);
    const settings = createTestSettings();
    const ui = createUiStore('dark');
    installTheme({ settings, ui });

    settings.set(THEME_SETTING, 'dark');
    media.set(true);
    expect(ui.getState().theme).toBe('dark');

    settings.set(THEME_SETTING, 'light');
    expect(ui.getState().theme).toBe('light');
    settings.set(THEME_SETTING, 'system');
    expect(ui.getState().theme).toBe('light');
    media.set(false);
    expect(ui.getState().theme).toBe('dark');
  });

  it('works without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const ui = createUiStore('light');
    installTheme({ settings: createTestSettings(), ui });
    expect(ui.getState().theme).toBe('dark');
  });
});

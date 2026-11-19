import { THEME_SETTING, THEME_STORAGE_KEY } from './app-settings';
import { createSettingsStore } from './settings';

export { THEME_STORAGE_KEY };

/** What is on screen; the stored choice (`appearance.theme`) may also be `system`. */
export type Theme = 'dark' | 'light';

export type ThemePreference = 'system' | Theme;

export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolveTheme(preference: ThemePreference, prefersLight: boolean): Theme {
  if (preference === 'system') return prefersLight ? 'light' : 'dark';
  return preference;
}

/** The theme at startup, read the way `public/theme-bootstrap.js` reads it, before any hydration. */
export function initialTheme(): Theme {
  return resolveTheme(createSettingsStore().get(THEME_SETTING), systemTheme() === 'light');
}

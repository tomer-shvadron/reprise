export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'reprise.theme';

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

export function readStoredTheme(
  storage: () => Storage = () => window.localStorage,
): Theme | undefined {
  try {
    const value = storage().getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredTheme(
  theme: Theme,
  storage: () => Storage = () => window.localStorage,
): void {
  try {
    storage().setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be disabled or full; the theme still applies for this session.
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function initialTheme(): Theme {
  return readStoredTheme() ?? systemTheme();
}

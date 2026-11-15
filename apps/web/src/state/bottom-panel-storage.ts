/** The bottom region's height in px; remembered per viewer in localStorage. */
export const BOTTOM_PANEL_HEIGHT = { default: 200, min: 120, max: 480 } as const;

export const BOTTOM_PANEL_HEIGHT_STORAGE_KEY = 'reprise.bottomPanelHeight';

export function readStoredBottomPanelHeight(
  storage: () => Storage = () => window.localStorage,
): number {
  try {
    const value = Number(storage().getItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY));
    const { min, max, default: fallback } = BOTTOM_PANEL_HEIGHT;
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch {
    return BOTTOM_PANEL_HEIGHT.default;
  }
}

export function writeStoredBottomPanelHeight(
  height: number,
  storage: () => Storage = () => window.localStorage,
): void {
  try {
    storage().setItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // Storage can be disabled or full; the height still applies for this session.
  }
}

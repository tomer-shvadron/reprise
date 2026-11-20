/** The panels' widths in px; a module of its own so the settings can name the right panel's. */
export const PANEL_WIDTH = {
  sidebar: { default: 240, min: 180, max: 400 },
  rightPanel: { default: 320, min: 240, max: 480 },
} as const;

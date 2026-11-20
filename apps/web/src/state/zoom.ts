/** The score zoom range; apart from `ui.ts` so a setting can name it without importing the ui store. */
export const ZOOM = { min: 0.5, max: 3, default: 1 } as const;

/** The practice mode is read from across a room, so it starts larger than the normal zoom. */
export const PRACTICE_ZOOM_DEFAULT = 1.5;

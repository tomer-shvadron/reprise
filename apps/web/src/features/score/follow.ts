import type { Rect } from '@reprise/layout';

/** Layout px kept above the current system by a page turn, and around a reveal. */
export const FOLLOW_MARGIN = 24;

/** The continuous glide's time constant, in ms. */
export const GLIDE_TAU = 200;

const MAX_STEP_MS = 100;

const bottom = (rect: Rect) => rect.y + rect.height;

function fullyVisible(window: Rect, rect: Rect): boolean {
  return rect.y >= window.y && bottom(rect) <= bottom(window);
}

/**
 * Paged mode's page turn, in view px: when the current band or the next one is not fully in view,
 * the window origin that puts the current band `margin` below the top. Instant when the current
 * band is off screen (a repeat or jump back), so the reader is not dragged through the score.
 */
export function pageTurn(
  window: Rect,
  current: Rect,
  next: Rect | undefined,
  margin = FOLLOW_MARGIN,
): { y: number; instant: boolean } | undefined {
  const currentShows = fullyVisible(window, current);
  if (currentShows && (!next || fullyVisible(window, next))) return undefined;
  const y = current.y - margin;
  if (Math.abs(y - window.y) < 0.5) return undefined;
  return { y, instant: !currentShows };
}

/**
 * The band of a system to keep in view: the system, or the followed track's staves when the
 * system is taller than the window.
 */
export function followBand(
  system: Rect,
  staves: Rect | undefined,
  windowHeight: number,
  margin = FOLLOW_MARGIN,
): Rect {
  return staves && system.height + 2 * margin > windowHeight ? staves : system;
}

/**
 * Continuous mode's next window x: an exponential approach to the line a third of the way in,
 * which smooths the page while the line keeps its true, uneven speed. Snaps when the line is
 * outside the window, or always with reduced motion.
 */
export function glide(
  x: number,
  width: number,
  lineX: number,
  dtMs: number,
  reducedMotion: boolean,
): number {
  const target = lineX - width / 3;
  if (reducedMotion || lineX < x || lineX > x + width) return target;
  const dt = Math.min(Math.max(dtMs, 0), MAX_STEP_MS);
  return x + (target - x) * (1 - Math.exp(-dt / GLIDE_TAU));
}

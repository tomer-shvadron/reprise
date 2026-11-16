import type { PracticeSession } from '@/state/practice';

/** Played time is added up at play and pause changes and at this interval while playing. */
export const CHECKPOINT_MS = 30_000;
/** A session ends after this long without the transport playing. */
export const IDLE_MS = 10 * 60_000;
/** Nothing is written for less play than this, unless a speed-trainer step completed. */
export const MIN_PLAYED_MS = 10_000;
/** A change to the session is written this long after the last one. */
export const WRITE_DEBOUNCE_MS = 1000;
/** A tempo must hold this long to count, so dragging a slider adds one sample, not dozens. */
export const TEMPO_SETTLE_MS = 500;

/**
 * Time played since `since`. One accrual is capped at twice the checkpoint interval, so a laptop
 * that slept while "playing" does not log the time it slept: a page that plays audio is not
 * throttled in the background, so a real gap between checkpoints never nears the cap.
 */
export function accrued(since: number, now: number): number {
  return Math.min(Math.max(now - since, 0), 2 * CHECKPOINT_MS);
}

/** Whether a session whose play stopped `gapMs` ago has been idle long enough to end. */
export function isIdle(gapMs: number): boolean {
  return gapMs >= IDLE_MS;
}

/** Whether the session is worth a row: enough play, or one completed speed-trainer step. */
export function isStorable(session: PracticeSession): boolean {
  return (
    session.playedMs >= MIN_PLAYED_MS ||
    session.loops.some((loop) => loop.bestPercent !== undefined)
  );
}

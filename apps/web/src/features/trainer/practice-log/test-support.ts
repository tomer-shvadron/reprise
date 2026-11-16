import type { PracticeSessionRow } from './row';

/** A valid row; tests override what they care about. */
export function rowOf(overrides: Partial<PracticeSessionRow> = {}): PracticeSessionRow {
  return {
    id: 'AAAAAAAAAAAA',
    songId: 'SONGSONGSONG',
    startedAt: 1000,
    endedAt: 61_000,
    playedMs: 60_000,
    loops: [],
    tempoHistory: [],
    ...overrides,
  };
}

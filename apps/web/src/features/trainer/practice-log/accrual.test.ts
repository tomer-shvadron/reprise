import { describe, expect, it } from 'vitest';

import { accrued, CHECKPOINT_MS, IDLE_MS, isIdle, isStorable, MIN_PLAYED_MS } from './accrual';

const session = (playedMs: number, bestPercent?: number) => ({
  songId: 'SONGSONGSONG',
  documentId: 'DOCDOCDOCDOC',
  startedAt: 0,
  playedMs,
  loops: bestPercent === undefined ? [] : [{ startBar: 'A', endBar: 'B', bestPercent }],
  tempoHistory: [],
});

describe('played time', () => {
  it('is the time since play started, never negative', () => {
    expect(accrued(1000, 8000)).toBe(7000);
    expect(accrued(8000, 1000)).toBe(0);
  });

  it('caps one accrual at twice the checkpoint interval, so a sleeping laptop logs nothing extra', () => {
    expect(accrued(0, 2 * CHECKPOINT_MS)).toBe(2 * CHECKPOINT_MS);
    expect(accrued(0, 8 * 60 * 60_000)).toBe(2 * CHECKPOINT_MS);
  });
});

describe('idle and storable', () => {
  it('is idle at exactly IDLE_MS', () => {
    expect(isIdle(0, IDLE_MS - 1)).toBe(false);
    expect(isIdle(0, IDLE_MS)).toBe(true);
  });

  it('stores from MIN_PLAYED_MS of play or one completed step', () => {
    expect(isStorable(session(MIN_PLAYED_MS - 1))).toBe(false);
    expect(isStorable(session(MIN_PLAYED_MS))).toBe(true);
    expect(isStorable(session(0, 80))).toBe(true);
  });
});

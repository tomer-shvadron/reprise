import { describe, expect, it } from 'vitest';

import { resumeTarget, songSummary } from './summary';
import { rowOf } from './test-support';

const loop = (startBar: string, endBar: string, extra = {}) => ({ startBar, endBar, ...extra });

describe('songSummary', () => {
  it('totals the time and lists sessions newest first', () => {
    const summary = songSummary([
      rowOf({ id: 'ONEONEONEONE', startedAt: 1000, playedMs: 60_000 }),
      rowOf({ id: 'TWOTWOTWOTWO', startedAt: 9000, playedMs: 30_000 }),
    ]);
    expect(summary.totalPlayedMs).toBe(90_000);
    expect(summary.sessions.map((session) => session.id)).toEqual(['TWOTWOTWOTWO', 'ONEONEONEONE']);
  });

  it('groups loops across sessions with the best tempo and the latest label', () => {
    const summary = songSummary([
      rowOf({
        startedAt: 1000,
        endedAt: 2000,
        loops: [loop('A', 'B', { bestPercent: 90, bestBpm: 108, label: { start: 1, end: 2 } })],
      }),
      rowOf({
        id: 'TWOTWOTWOTWO',
        startedAt: 5000,
        endedAt: 6000,
        loops: [
          loop('C', 'D'),
          loop('A', 'B', { bestPercent: 70, bestBpm: 84, label: { start: 2, end: 3 } }),
        ],
      }),
    ]);
    expect(summary.loops).toEqual([
      expect.objectContaining({
        startBar: 'A',
        bestPercent: 90,
        bestBpm: 108,
        label: { start: 2, end: 3 },
        lastPracticedAt: 6000,
      }),
      expect.objectContaining({ startBar: 'C', bestPercent: undefined, lastPracticedAt: 6000 }),
    ]);
  });
});

describe('resumeTarget', () => {
  const tempo = (value: number) => ({ atPlayedMs: 0, tempo: { mode: 'percent' as const, value } });

  it('takes the last loop of the newest session that has one, at that session’s last tempo', () => {
    const target = resumeTarget([
      rowOf({ startedAt: 1000, loops: [loop('A', 'B')], tempoHistory: [tempo(70)] }),
      rowOf({
        id: 'TWOTWOTWOTWO',
        startedAt: 2000,
        loops: [loop('A', 'B'), loop('C', 'D')],
        tempoHistory: [tempo(80), tempo(85)],
      }),
      rowOf({ id: 'THRTHRTHRTHR', startedAt: 3000, loops: [], tempoHistory: [tempo(100)] }),
    ]);
    expect(target).toEqual({
      loop: { startBar: 'C', endBar: 'D' },
      tempo: { mode: 'percent', value: 85 },
    });
  });

  it('falls back to the latest session’s tempo with no loop anywhere', () => {
    expect(
      resumeTarget([
        rowOf({ startedAt: 1000, tempoHistory: [tempo(60)] }),
        rowOf({ id: 'TWOTWOTWOTWO', startedAt: 2000, tempoHistory: [tempo(90)] }),
      ]),
    ).toEqual({ loop: undefined, tempo: { mode: 'percent', value: 90 } });
  });

  it('has nothing to resume without rows, or a loop or tempo', () => {
    expect(resumeTarget([])).toBeUndefined();
    expect(resumeTarget([rowOf()])).toBeUndefined();
  });
});

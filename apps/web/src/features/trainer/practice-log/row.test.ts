import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { PracticeSession } from '@/state/practice';
import { fourBars } from '@/test/position';

import { PracticeSessionRowSchema, TEMPO_HISTORY_CAP, toRow } from './row';

const song = fourBars();
const bars = song.masterBars;

function sessionOf(overrides: Partial<PracticeSession> = {}): PracticeSession {
  return {
    songId: 'SONGSONGSONG',
    documentId: 'DOCDOCDOCDOC',
    startedAt: 1000,
    playedMs: 12_345.6,
    loops: [],
    tempoHistory: [],
    ...overrides,
  };
}

const context = { id: 'ROWROWROWROW', songId: 'SONGSONGSONG', endedAt: 50_000 };

describe('toRow', () => {
  it('round-trips through its schema', () => {
    const [first, , third] = bars;
    const row = toRow(
      sessionOf({
        loops: [{ startBar: first?.id ?? '', endBar: third?.id ?? '', bestPercent: 80 }],
        tempoHistory: [{ atPlayedMs: 0, tempo: { mode: 'percent', value: 80 } }],
      }),
      { ...context, score: song },
    );
    expect(PracticeSessionRowSchema.parse(row)).toEqual(row);
    expect(row.playedMs).toBe(12_346);
  });

  it('stores bar numbers and the BPM of the best step at write time', () => {
    const [, second, third] = bars;
    const row = toRow(
      sessionOf({
        loops: [{ startBar: second?.id ?? '', endBar: third?.id ?? '', bestPercent: 50 }],
      }),
      { ...context, score: song },
    );
    // Written tempo at bar 2 is 120.
    expect(row.loops[0]).toMatchObject({
      label: { start: 2, end: 3 },
      bestPercent: 50,
      bestBpm: 60,
    });
  });

  it('omits an undefined percent, and what a missing score or bar cannot give', () => {
    const [first] = bars;
    const noPercent = toRow(
      sessionOf({
        loops: [{ startBar: first?.id ?? '', endBar: first?.id ?? '', bestPercent: undefined }],
      }),
      { ...context, score: song },
    );
    expect(noPercent.loops[0]).not.toHaveProperty('bestPercent');
    expect(noPercent.loops[0]).not.toHaveProperty('bestBpm');
    const gone = toRow(
      sessionOf({ loops: [{ startBar: 'GONEGONEGONE', endBar: 'GONEGONEGONE', bestPercent: 90 }] }),
      { ...context, score: song },
    );
    expect(gone.loops[0]).toEqual({
      startBar: 'GONEGONEGONE',
      endBar: 'GONEGONEGONE',
      bestPercent: 90,
    });
    const noScore = toRow(
      sessionOf({
        loops: [{ startBar: first?.id ?? '', endBar: first?.id ?? '', bestPercent: 90 }],
      }),
      {
        ...context,
        score: undefined,
      },
    );
    expect(noScore.loops[0]).not.toHaveProperty('label');
  });

  it('keeps loop order and caps the tempo history at its last entries', () => {
    const other = score().track('guitar').bar().build();
    const loops = [
      { startBar: 'AAAAAAAAAAAA', endBar: 'BBBBBBBBBBBB', bestPercent: undefined },
      { startBar: 'CCCCCCCCCCCC', endBar: 'DDDDDDDDDDDD', bestPercent: undefined },
    ];
    const tempoHistory = Array.from({ length: TEMPO_HISTORY_CAP + 20 }, (_, index) => ({
      atPlayedMs: index,
      tempo: { mode: 'bpm' as const, value: 60 + index },
    }));
    const row = toRow(sessionOf({ loops, tempoHistory }), { ...context, score: other });
    expect(row.loops.map((loop) => loop.startBar)).toEqual(['AAAAAAAAAAAA', 'CCCCCCCCCCCC']);
    expect(row.tempoHistory).toHaveLength(TEMPO_HISTORY_CAP);
    expect(row.tempoHistory[0]?.atPlayedMs).toBe(20);
  });
});

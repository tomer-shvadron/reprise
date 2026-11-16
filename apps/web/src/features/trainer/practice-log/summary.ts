import type { PracticeLoopRow, PracticeSessionRow } from './row';

export interface LoopSummary {
  startBar: string;
  endBar: string;
  /** The highest across every session. */
  bestPercent: number | undefined;
  bestBpm: number | undefined;
  /** From the latest session that stored one; the page prefers a live reading when the song is open. */
  label: PracticeLoopRow['label'];
  lastPracticedAt: number;
}

export interface SongSummary {
  totalPlayedMs: number;
  /** Newest first. */
  sessions: PracticeSessionRow[];
  /** Most recently practised first. */
  loops: LoopSummary[];
}

const byStart = (a: PracticeSessionRow, b: PracticeSessionRow) => a.startedAt - b.startedAt;

const higher = (a: number | undefined, b: number | undefined) =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

export function songSummary(rows: readonly PracticeSessionRow[]): SongSummary {
  const oldestFirst = [...rows].sort(byStart);
  const loops = new Map<string, LoopSummary>();
  for (const session of oldestFirst) {
    for (const loop of session.loops) {
      const key = `${loop.startBar}:${loop.endBar}`;
      const before = loops.get(key);
      loops.set(key, {
        startBar: loop.startBar,
        endBar: loop.endBar,
        bestPercent: higher(before?.bestPercent, loop.bestPercent),
        bestBpm: higher(before?.bestBpm, loop.bestBpm),
        label: loop.label ?? before?.label,
        lastPracticedAt: session.endedAt,
      });
    }
  }
  return {
    totalPlayedMs: rows.reduce((total, row) => total + row.playedMs, 0),
    sessions: oldestFirst.reverse(),
    loops: [...loops.values()].sort((a, b) => b.lastPracticedAt - a.lastPracticedAt),
  };
}

export interface ResumeTarget {
  loop: { startBar: string; endBar: string } | undefined;
  tempo: PracticeSessionRow['tempoHistory'][number]['tempo'] | undefined;
}

/**
 * What Resume restores: the last loop of the most recent session that worked on one, at that
 * session's last tempo. With no loop anywhere, the latest session's tempo alone.
 */
export function resumeTarget(rows: readonly PracticeSessionRow[]): ResumeTarget | undefined {
  const newestFirst = [...rows].sort(byStart).reverse();
  const withLoop = newestFirst.find((session) => session.loops.length > 0);
  const session = withLoop ?? newestFirst[0];
  if (!session) return undefined;
  const last = session.loops.at(-1);
  const loop = last ? { startBar: last.startBar, endBar: last.endBar } : undefined;
  const tempo = session.tempoHistory.at(-1)?.tempo;
  return loop || tempo ? { loop, tempo } : undefined;
}

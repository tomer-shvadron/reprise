import { bpmAtTick, loopRange } from '@reprise/audio';
import { IdSchema, type Id, type Score } from '@reprise/model';
import { z } from 'zod';

import type { PracticeSession } from '@/state/practice';
import { timelineOf } from '@/state/timeline';

/** The tempo history keeps its last entries only: a long session would otherwise grow a row without bound. */
export const TEMPO_HISTORY_CAP = 100;

const TempoSchema = z.object({
  mode: z.enum(['percent', 'bpm']),
  value: z.number(),
});

/**
 * One run of practice on one library song, as stored in `practiceSessions`. The trainer owns it
 * (only the trainer reads and writes it); the library's schema imports its type only.
 */
export const PracticeSessionRowSchema = z.object({
  id: IdSchema,
  songId: IdSchema,
  /** Epoch milliseconds. */
  startedAt: z.number(),
  /** Epoch milliseconds of the last activity, never of a flush, so idle time is not practice. */
  endedAt: z.number(),
  playedMs: z.number(),
  /** Last used last, as in `PracticeSession.loops`. */
  loops: z.array(
    z.object({
      /** The truth: resolved against the score on resume, so it survives bars inserted before it. */
      startBar: IdSchema,
      endBar: IdSchema,
      bestPercent: z.number().exactOptional(),
      /** `bestPercent` of the written tempo at the loop's first tick, at write time. */
      bestBpm: z.number().exactOptional(),
      /** 1-based bar numbers at write time, for display when the song is closed. */
      label: z.object({ start: z.number(), end: z.number() }).exactOptional(),
    }),
  ),
  tempoHistory: z.array(z.object({ atPlayedMs: z.number(), tempo: TempoSchema })),
});

export type PracticeSessionRow = z.infer<typeof PracticeSessionRowSchema>;
export type PracticeLoopRow = PracticeSessionRow['loops'][number];

export interface RowContext {
  id: Id;
  songId: Id;
  endedAt: number;
  /** The score of the session's document, when still known; it fills `label` and `bestBpm`. */
  score: Score | undefined;
}

function describeLoop(
  score: Score | undefined,
  loop: PracticeSession['loops'][number],
): Pick<PracticeLoopRow, 'label' | 'bestBpm'> {
  if (!score) return {};
  const start = score.masterBars.findIndex((bar) => bar.id === loop.startBar);
  const end = score.masterBars.findIndex((bar) => bar.id === loop.endBar);
  if (start < 0 || end < 0) return {};
  const described: Pick<PracticeLoopRow, 'label' | 'bestBpm'> = {
    label: { start: start + 1, end: end + 1 },
  };
  if (loop.bestPercent !== undefined) {
    try {
      const timeline = timelineOf(score);
      const bpm = bpmAtTick(timeline, loopRange(timeline, loop, 0).startTick);
      described.bestBpm = Math.round((bpm * loop.bestPercent) / 100);
    } catch (error) {
      // A loop the engine cannot play has no tempo to report; the percent still stands.
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return described;
}

export function toRow(session: PracticeSession, context: RowContext): PracticeSessionRow {
  return {
    id: context.id,
    songId: context.songId,
    startedAt: session.startedAt,
    endedAt: Math.max(context.endedAt, session.startedAt),
    playedMs: Math.round(session.playedMs),
    loops: session.loops.map((loop) => ({
      startBar: loop.startBar,
      endBar: loop.endBar,
      ...(loop.bestPercent !== undefined && { bestPercent: loop.bestPercent }),
      ...describeLoop(context.score, loop),
    })),
    tempoHistory: session.tempoHistory.slice(-TEMPO_HISTORY_CAP).map(({ atPlayedMs, tempo }) => ({
      atPlayedMs,
      tempo: { mode: tempo.mode, value: tempo.value },
    })),
  };
}

import type { Id } from '@reprise/model';
import { create } from 'zustand';

import type { TempoSetting } from './playback';
import type { BarRange } from './selection';

/** A tempo the player was set to, and when, measured in milliseconds of played time. */
export interface TempoSample {
  /** Played time (`playedMs`) at the moment the tempo changed, so pauses do not stretch the history. */
  atPlayedMs: number;
  tempo: TempoSetting;
}

/**
 * A loop worked on during a session, by bar id so it survives an edit that inserts bars before it.
 * `bestPercent` is the highest speed, as a percent of the written tempo, at which the speed
 * trainer completed a full step on this loop; the trainer converts a BPM target into a percent.
 */
export interface LoopRecord extends BarRange {
  bestPercent: number | undefined;
}

/** What WP-073 stores in `practiceSessions`: one run of practice on one song. */
export interface PracticeSession {
  /** The library song, when the document came from the library; absent for an unimported file. */
  songId: Id | undefined;
  /** The open document, so a session never outlives a switch. */
  documentId: Id;
  /** Epoch milliseconds, from the clock given to `start`. */
  startedAt: number;
  /** Total time the transport spent playing. */
  playedMs: number;
  /** Ordered by last use, oldest first, so `loops.at(-1)` is the loop "resume" restores. */
  loops: readonly LoopRecord[];
  tempoHistory: readonly TempoSample[];
}

export interface PracticeState {
  /** The running session; undefined until the first play of a document. */
  session: PracticeSession | undefined;
  /**
   * Starts a session unless one runs for this document. Another document's running session is
   * replaced and returned, so the caller can store it; a call that changes nothing returns undefined.
   */
  start(args: { songId: Id | undefined; documentId: Id; now: number }): PracticeSession | undefined;
  /** Attributes the session to a library song, as after importing a file opened without import. */
  setSongId(songId: Id | undefined): void;
  addPlayed(ms: number): void;
  /** Notes that `range` is being worked on: adds its record and makes it the most recently used. */
  noteLoop(range: BarRange): void;
  recordTempo(tempo: TempoSetting): void;
  /**
   * A full speed-trainer step completed on `range` at `percent`; keeps the highest. The loop
   * itself is `playback.settings.loop`, which the trainer passes in. Also makes it most recent.
   */
  recordStep(range: BarRange, percent: number): void;
  /** Ends and returns the session for the log to store; undefined when none runs. */
  end(): PracticeSession | undefined;
}

const sameRange = (a: BarRange, b: BarRange) => a.startBar === b.startBar && a.endBar === b.endBar;

/** `loops` with `range` moved to the end (added if new), its best percent raised to `percent`. */
function touched(
  loops: readonly LoopRecord[],
  range: BarRange,
  percent: number | undefined,
): LoopRecord[] {
  const existing = loops.find((loop) => sameRange(loop, range));
  const best = Math.max(existing?.bestPercent ?? 0, percent ?? 0) || undefined;
  return [
    ...loops.filter((loop) => loop !== existing),
    { startBar: range.startBar, endBar: range.endBar, bestPercent: best },
  ];
}

export function createPracticeStore() {
  return create<PracticeState>()((set, get) => ({
    session: undefined,

    start({ songId, documentId, now }) {
      const previous = get().session;
      if (previous?.documentId === documentId) return undefined;
      set({
        session: { songId, documentId, startedAt: now, playedMs: 0, loops: [], tempoHistory: [] },
      });
      return previous;
    },

    setSongId(songId) {
      const { session } = get();
      if (session) set({ session: { ...session, songId } });
    },

    addPlayed(ms) {
      const { session } = get();
      if (!session || ms <= 0) return;
      set({ session: { ...session, playedMs: session.playedMs + ms } });
    },

    noteLoop(range) {
      const { session } = get();
      if (session)
        set({ session: { ...session, loops: touched(session.loops, range, undefined) } });
    },

    recordTempo(tempo) {
      const { session } = get();
      if (!session) return;
      const last = session.tempoHistory.at(-1)?.tempo;
      if (last?.mode === tempo.mode && last.value === tempo.value) return;
      set({
        session: {
          ...session,
          tempoHistory: [...session.tempoHistory, { atPlayedMs: session.playedMs, tempo }],
        },
      });
    },

    recordStep(range, percent) {
      const { session } = get();
      if (session) set({ session: { ...session, loops: touched(session.loops, range, percent) } });
    },

    end() {
      const { session } = get();
      set({ session: undefined });
      return session;
    },
  }));
}

export type PracticeStore = ReturnType<typeof createPracticeStore>;

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
  loops: readonly LoopRecord[];
  tempoHistory: readonly TempoSample[];
}

export interface PracticeState {
  /** The running session; undefined until the first play of a document. */
  session: PracticeSession | undefined;
  /** The loop in force now, whose record `recordStep` raises; undefined outside a loop. */
  activeLoop: BarRange | undefined;
  /** Starts a session unless one runs for this document; a different document ends the old one first. */
  start(args: { songId: Id | undefined; documentId: Id; now: number }): void;
  addPlayed(ms: number): void;
  /** Sets or clears the loop in force; a range seen for the first time gets a record. */
  setLoop(range: BarRange | undefined): void;
  recordTempo(tempo: TempoSetting): void;
  /** A full speed-trainer step completed on the active loop at `percent`; keeps the highest. */
  recordStep(percent: number): void;
  /** Ends and returns the session for the log to store; undefined when none runs. */
  end(): PracticeSession | undefined;
}

const sameRange = (a: BarRange, b: BarRange) => a.startBar === b.startBar && a.endBar === b.endBar;

export function createPracticeStore() {
  return create<PracticeState>()((set, get) => ({
    session: undefined,
    activeLoop: undefined,

    start({ songId, documentId, now }) {
      if (get().session?.documentId === documentId) return;
      set({
        session: { songId, documentId, startedAt: now, playedMs: 0, loops: [], tempoHistory: [] },
        activeLoop: undefined,
      });
    },

    addPlayed(ms) {
      const { session } = get();
      if (!session || ms <= 0) return;
      set({ session: { ...session, playedMs: session.playedMs + ms } });
    },

    setLoop(range) {
      const { session } = get();
      if (!range) {
        set({ activeLoop: undefined });
        return;
      }
      const known = session?.loops.some((loop) => sameRange(loop, range));
      set({
        activeLoop: range,
        ...(session &&
          !known && {
            session: {
              ...session,
              loops: [
                ...session.loops,
                { startBar: range.startBar, endBar: range.endBar, bestPercent: undefined },
              ],
            },
          }),
      });
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

    recordStep(percent) {
      const { session, activeLoop } = get();
      if (!session || !activeLoop) return;
      set({
        session: {
          ...session,
          loops: session.loops.map((loop) =>
            sameRange(loop, activeLoop) && percent > (loop.bestPercent ?? 0)
              ? { ...loop, bestPercent: percent }
              : loop,
          ),
        },
      });
    },

    end() {
      const { session } = get();
      set({ session: undefined, activeLoop: undefined });
      return session;
    },
  }));
}

export type PracticeStore = ReturnType<typeof createPracticeStore>;

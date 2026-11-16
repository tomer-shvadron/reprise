import type { Id } from '@reprise/model';
import { create } from 'zustand';

import type { EditCursor } from '@/state/selection';

import { QUARTER, type Rhythm } from './rhythm';

export type EntryMode = 'overwrite' | 'insert';

/** A refusal reads as an error; a notice (a paste's summary, a re-fingering) is only information. */
export type MessageTone = 'refusal' | 'notice';

/** A first fret digit that waits for a second, with the place it was typed at. */
export interface PendingFret {
  fret: number;
  cursor: EditCursor;
}

export interface EntryState {
  /** The length a new beat gets; follows the beat the cursor last sat on. */
  rhythm: Rhythm;
  mode: EntryMode;
  pending: PendingFret | undefined;
  /** The beat insert mode just created: further digits on it are chord notes, not new beats. */
  inserted: Id | undefined;
  /** The last refusal or notice; clears on the next successful entry or cursor move. */
  message: string | undefined;
  tone: MessageTone;
  setRhythm(rhythm: Rhythm): void;
  setMode(mode: EntryMode): void;
  toggleMode(): void;
  setPending(pending: PendingFret | undefined): void;
  setInserted(inserted: Id | undefined): void;
  setMessage(message: string | undefined, tone?: MessageTone): void;
}

/**
 * Entry state no other feature reads, for the session only: it is not persisted and not part of
 * the document. The voice is not here, it is the edit cursor's.
 */
export function createEntryStore() {
  return create<EntryState>()((set) => ({
    rhythm: QUARTER,
    mode: 'overwrite',
    pending: undefined,
    inserted: undefined,
    message: undefined,
    tone: 'refusal',
    setRhythm: (rhythm) => {
      set({ rhythm });
    },
    setMode: (mode) => {
      set({ mode });
    },
    toggleMode: () => {
      set((state) => ({ mode: state.mode === 'insert' ? 'overwrite' : 'insert' }));
    },
    setPending: (pending) => {
      set({ pending });
    },
    setInserted: (inserted) => {
      set({ inserted });
    },
    setMessage: (message, tone = 'refusal') => {
      set({ message, tone });
    },
  }));
}

export type EntryStore = ReturnType<typeof createEntryStore>;

import {
  GM_BUDGET_BYTES,
  type LoopEvent,
  type MemoryReport,
  type PlaybackState,
  type PositionEvent,
  type TempoMode,
  type TrackParams,
} from '@reprise/audio';
import type { Id } from '@reprise/model';
import { create } from 'zustand';

import type { BarRange } from './selection';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TransportSettings {
  tempo: { mode: TempoMode; value: number };
  loop: BarRange | undefined;
  countIn: boolean;
  metronome: { on: boolean; volume: number };
}

/** A mirror of the audio service: only the service writes it, through `setState`. */
export interface PlaybackStoreState {
  transport: PlaybackState;
  /** The engine's last position; undefined with no engine or no document. */
  position: PositionEvent | undefined;
  lastLoop: LoopEvent | undefined;
  memory: MemoryReport;
  /** The AudioContext: `locked` until the first user gesture creates it. */
  output: { status: 'locked' | 'ready' | 'error'; error: string | undefined };
  /** The General MIDI sound bank. */
  sounds: {
    status: LoadStatus;
    loaded: number;
    total: number | undefined;
    error: string | undefined;
  };
  /** The open document's opening bars, decoded. */
  song: { status: LoadStatus; error: string | undefined };
  settings: TransportSettings;
  /** The user's overrides over each track's `channel`; cleared on a switch. */
  mixer: Readonly<Record<Id, TrackParams>>;
}

export const selectCanPlay = (state: PlaybackStoreState): boolean =>
  state.song.status === 'ready' && state.output.status !== 'error';

export const selectRunning = (state: PlaybackStoreState): boolean =>
  state.transport === 'playing' || state.transport === 'counting-in';

export function initialPlaybackState(): PlaybackStoreState {
  return {
    transport: 'stopped',
    position: undefined,
    lastLoop: undefined,
    memory: { decodedBytes: 0, budgetBytes: GM_BUDGET_BYTES, residents: [] },
    output: { status: 'locked', error: undefined },
    sounds: { status: 'idle', loaded: 0, total: undefined, error: undefined },
    song: { status: 'idle', error: undefined },
    settings: {
      tempo: { mode: 'percent', value: 100 },
      loop: undefined,
      countIn: false,
      metronome: { on: false, volume: 0.7 },
    },
    mixer: {},
  };
}

export function createPlaybackStore() {
  return create<PlaybackStoreState>()(() => initialPlaybackState());
}

export type PlaybackStore = ReturnType<typeof createPlaybackStore>;

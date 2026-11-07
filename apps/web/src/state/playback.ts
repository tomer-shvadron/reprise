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

export interface TempoSetting {
  mode: TempoMode;
  value: number;
}

export interface TransportSettings {
  tempo: TempoSetting;
  loop: BarRange | undefined;
  countIn: boolean;
  metronome: { on: boolean; volume: number };
  /** The output level, 0 to 1, over notes and clicks alike; the mixer (WP-052) binds it too. */
  masterVolume: number;
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
  /** The open song's planned instruments; the memory report's residents also count preset aliases. */
  instruments: number;
  settings: TransportSettings;
  /** The user's overrides over each track's `channel`; cleared on a switch. */
  mixer: Readonly<Record<Id, TrackParams>>;
  /** Tracks whose newly chosen instrument is still decoding; cleared on a switch. */
  instrumentLoads: Readonly<Record<Id, InstrumentLoad>>;
}

export interface InstrumentLoad {
  loaded: number;
  total: number;
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
    instruments: 0,
    settings: {
      tempo: { mode: 'percent', value: 100 },
      loop: undefined,
      countIn: false,
      metronome: { on: false, volume: 0.7 },
      masterVolume: 1,
    },
    mixer: {},
    instrumentLoads: {},
  };
}

export function createPlaybackStore() {
  return create<PlaybackStoreState>()(() => initialPlaybackState());
}

export type PlaybackStore = ReturnType<typeof createPlaybackStore>;

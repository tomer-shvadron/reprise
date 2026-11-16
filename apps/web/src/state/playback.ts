import {
  DEFAULT_CLICK_SETTINGS,
  GM_BUDGET_BYTES,
  HQ_BUDGET_BYTES,
  type ClickSettings,
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
  /**
   * Only the automatic preset is skipped on GM-tier tracks; on by default, since the soundfont's
   * samples are already processed. A track's known `sound.preset` applies either way.
   */
  gmTierBypass: boolean;
  /**
   * "Memory for sounds" in bytes, the engine's memory setting: the HQ tier's budget, and a cap on
   * the GM tier's. `MEMORY_BUDGET_RANGE` bounds it; the default is the HQ budget.
   */
  memoryBudgetBytes: number;
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
  /** The open song's planned instruments; the memory report's residents can add leftovers. */
  instruments: number;
  settings: TransportSettings;
  /** The standalone click (no song needed): whether it runs, and what it plays. */
  click: { running: boolean; settings: ClickSettings };
  /** The user's overrides over each track's `channel`; cleared on a switch. */
  mixer: Readonly<Record<Id, TrackParams>>;
  /** Tracks whose newly chosen instrument is still decoding; cleared on a switch. */
  instrumentLoads: Readonly<Record<Id, InstrumentLoad>>;
  /** Every track of the open song, by id; cleared on a switch. */
  trackSounds: Readonly<Record<Id, TrackSound>>;
}

/**
 * How one track sounds: its tier, and why a pack it names is not playing. `tier` follows the
 * audio package's `tierOf`: `hq` only while a pack plays; a track naming a pack that is not
 * installed (`missing`) or whose pack failed to load (`failed`, with the engine's `message`) is
 * `gm` and plays the soundfont. `packId` is the pack the track names.
 */
export interface TrackSound {
  tier: 'gm' | 'hq';
  packId?: string;
  problem?: 'missing' | 'failed';
  message?: string;
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
    memory: {
      decodedBytes: 0,
      budgetBytes: GM_BUDGET_BYTES,
      residents: [],
      unused: [],
      shortfall: false,
    },
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
      gmTierBypass: true,
      memoryBudgetBytes: HQ_BUDGET_BYTES,
    },
    click: { running: false, settings: DEFAULT_CLICK_SETTINGS },
    mixer: {},
    instrumentLoads: {},
    trackSounds: {},
  };
}

export function createPlaybackStore() {
  return create<PlaybackStoreState>()(() => initialPlaybackState());
}

export type PlaybackStore = ReturnType<typeof createPlaybackStore>;

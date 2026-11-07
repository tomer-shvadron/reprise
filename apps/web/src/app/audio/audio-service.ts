import {
  createAudioEngine,
  GM_BUDGET_BYTES,
  Sf2ParseError,
  Sf2Soundfont,
  timelineNeutral,
  type AudioEngine,
  type LoadOptions,
  type PlaybackState,
  type TempoMode,
  type Ticker,
  type TrackParams,
} from '@reprise/audio';
import type { Id, Score } from '@reprise/model';

import { selectCanPlay, type PlaybackStore, type PlaybackStoreState } from '@/state/playback';
import type { BarRange } from '@/state/selection';

import { loadGmSoundfont, SoundfontError, type SoundfontLoader } from './soundfont-loader';

export interface AudioServiceOptions {
  playback: PlaybackStore;
  loadSoundfont?: SoundfontLoader;
  createContext?: () => BaseAudioContext;
  /** Offline tests drive the engine with manual tickers. */
  scheduler?: Ticker;
  frames?: Ticker;
  startLatency?: number;
  budgetBytes?: number;
  /** Runs an edit's rebuild; a task later by default, out of the layout's task. */
  defer?: (run: () => void) => void;
}

export interface OpenDocument {
  id: Id;
  score: Score;
}

/** The engine behind the service; tests reach its live objects with `@reprise/audio/testing`. */
export interface AudioServiceDebug {
  engine: AudioEngine;
}

export interface AudioService {
  /** Creates the AudioContext on the first call, resumes a suspended one after. */
  unlock(): void;
  setDocument(document: OpenDocument | undefined): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  stop(): void;
  /** Ignored until the engine has the open song, which waits on the sound bank. */
  seek(tick: number): void;
  /** Seconds between the clock positions are read from and what is heard; 0 with no context. */
  outputLatency(): number;
  setTempo(mode: TempoMode, value: number): void;
  setLoop(range?: BarRange): void;
  setCountIn(on: boolean): void;
  setMetronome(on: boolean, volume: number): void;
  /**
   * The master bus level, 0 to 1, mirrored into `settings.masterVolume`. The metronome feeds the
   * bus, so it scales the clicks too. Throws a `RangeError` outside 0 to 1.
   */
  setMasterVolume(volume: number): void;
  /** A user override over the track's channel, kept through every baseline reset. */
  setTrack(id: Id, params: TrackParams): void;
  /**
   * Sets the strip's volume or pan for a slider being dragged: no override and no store write, so
   * the next baseline reset or the committed edit replaces it.
   */
  previewTrack(id: Id, params: Pick<TrackParams, 'volume' | 'pan'>): void;
  /** After a sound, song or output error. */
  retry(): void;
  /** Resolves with no rebuild pending, the document's load done and no decode in flight. */
  settled(): Promise<void>;
  debug(): AudioServiceDebug;
  dispose(): void;
}

const GM: LoadOptions = { tier: 'gm', packs: [] };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const isRunning = (state: PlaybackState) => state === 'playing' || state === 'counting-in';

export function createAudioService(options: AudioServiceOptions): AudioService {
  const {
    playback,
    loadSoundfont = loadGmSoundfont,
    createContext = () => new AudioContext({ latencyHint: 'interactive' }),
    budgetBytes = GM_BUDGET_BYTES,
    defer = (run) => setTimeout(run, 0),
  } = options;

  const engine = createAudioEngine({
    context: createContext,
    budgetBytes,
    ...(options.scheduler && { scheduler: options.scheduler }),
    ...(options.frames && { frames: options.frames }),
    ...(options.startLatency !== undefined && { startLatency: options.startLatency }),
  });
  const initial = playback.getState().settings;
  engine.setTempo(initial.tempo.mode, initial.tempo.value);
  engine.setCountIn(initial.countIn);
  engine.setMetronome(initial.metronome.on, initial.metronome.volume);
  engine.setMasterVolume(initial.masterVolume);
  let bankLoad: Promise<void> | undefined;
  let doc: OpenDocument | undefined;
  /** The engine has this document's song. */
  let loaded = false;
  let mixer: Record<Id, TrackParams> = {};
  let generation = 0;
  let transport: PlaybackState = 'stopped';
  let rebuildQueued = false;
  let disposed = false;
  const inflight = new Set<Promise<unknown>>();

  const track = <T>(promise: Promise<T>): Promise<T> => {
    const settled = promise.then(
      () => undefined,
      () => undefined,
    );
    inflight.add(settled);
    void settled.then(() => inflight.delete(settled));
    return promise;
  };

  const set = (partial: Partial<PlaybackStoreState>) => {
    if (!disposed) playback.setState(partial);
  };
  const setSettings = (partial: Partial<PlaybackStoreState['settings']>) => {
    set({ settings: { ...playback.getState().settings, ...partial } });
  };

  const cleanups = [
    engine.on('state', (state) => {
      transport = state;
      set({ transport: state });
    }),
    engine.on('position', (position) => {
      set({ position });
    }),
    engine.on('loop', (loop) => {
      set({ lastLoop: loop });
    }),
    engine.on('memory', (memory) => {
      set({ memory });
    }),
    engine.on('instrumentLoads', (instrumentLoads) => {
      set({ instrumentLoads });
    }),
  ];

  function ensureBank(): Promise<void> {
    bankLoad ??= (async () => {
      const sounds = (partial: Partial<PlaybackStoreState['sounds']>) => {
        set({ sounds: { ...playback.getState().sounds, ...partial } });
      };
      sounds({ status: 'loading', loaded: 0, total: undefined, error: undefined });
      try {
        const bytes = await loadSoundfont((loaded, total) => {
          sounds({ loaded, total });
        });
        let font: Sf2Soundfont;
        try {
          font = Sf2Soundfont.parse(bytes);
        } catch (error) {
          if (!(error instanceof Sf2ParseError)) throw error;
          throw new SoundfontError('damaged', `The sound bank is damaged: ${error.message}`, {
            cause: error,
          });
        }
        if (disposed) throw new Error('The audio service was disposed');
        engine.setSoundfont(font);
        set({ memory: engine.memory() });
        sounds({ status: 'ready', loaded: bytes.length, total: bytes.length, error: undefined });
      } catch (error) {
        sounds({ status: 'error', error: messageOf(error) });
        throw error;
      }
    })();
    return bankLoad;
  }

  async function loadDocument(gen: number): Promise<void> {
    try {
      await ensureBank();
      if (gen !== generation || !doc) return;
      loaded = true;
      const { instruments } = await engine.load(doc.score, GM);
      if (gen === generation) {
        set({ song: { status: 'ready', error: undefined }, instruments: instruments.length });
      }
    } catch (error) {
      if (gen === generation) set({ song: { status: 'error', error: messageOf(error) } });
    }
  }

  /** Hands the engine the document's latest score; the engine keeps the position (Q5). */
  function reload(): void {
    if (!doc || !loaded) return;
    const gen = generation;
    void track(
      engine.load(doc.score, GM).then(
        ({ instruments }) => {
          if (gen === generation) set({ instruments: instruments.length });
        },
        (error: unknown) => {
          if (gen === generation) set({ song: { status: 'error', error: messageOf(error) } });
        },
      ),
    );
  }

  function scheduleRebuild(): void {
    if (rebuildQueued) return;
    rebuildQueued = true;
    void track(
      new Promise<void>((resolve) => {
        defer(() => {
          rebuildQueued = false;
          try {
            if (!disposed) reload();
          } finally {
            resolve();
          }
        });
      }),
    );
  }

  function clear(partial: Partial<PlaybackStoreState>): void {
    loaded = false;
    mixer = {};
    set({ mixer: {}, instrumentLoads: {}, position: undefined, ...partial });
  }

  const service: AudioService = {
    unlock() {
      if (disposed) return;
      try {
        engine.unlock();
      } catch (error) {
        set({
          output: { status: 'error', error: `Audio output is unavailable: ${messageOf(error)}` },
        });
        return;
      }
      if (playback.getState().output.status !== 'ready') {
        set({ output: { status: 'ready', error: undefined } });
      }
    },

    setDocument(next) {
      if (disposed) return;
      if (!next) {
        if (!doc) return;
        generation += 1;
        engine.unload({ evict: true });
        doc = undefined;
        clear({ song: { status: 'idle', error: undefined }, instruments: 0 });
        return;
      }
      if (doc?.id === next.id) {
        if (doc.score === next.score) return;
        const previous = doc.score;
        doc = next;
        if (!loaded) return;
        if (!rebuildQueued && timelineNeutral(previous, next.score)) reload();
        else scheduleRebuild();
        return;
      }
      engine.unload();
      generation += 1;
      doc = next;
      clear({
        song: { status: 'loading', error: undefined },
        settings: { ...playback.getState().settings, loop: undefined },
      });
      void track(loadDocument(generation));
    },

    play() {
      service.unlock();
      if (!loaded || !selectCanPlay(playback.getState())) return;
      engine.play();
    },

    pause() {
      engine.pause();
    },

    togglePlay() {
      if (isRunning(transport)) service.pause();
      else service.play();
    },

    stop() {
      engine.stop();
    },

    seek(tick) {
      if (!loaded) return;
      engine.seek(tick);
    },

    outputLatency() {
      return engine.outputLatency();
    },

    setTempo(mode, value) {
      engine.setTempo(mode, value);
      setSettings({ tempo: { mode, value } });
    },

    setLoop(range) {
      engine.setLoop(range);
      setSettings({ loop: range });
    },

    setCountIn(on) {
      engine.setCountIn(on);
      setSettings({ countIn: on });
    },

    setMetronome(on, volume) {
      engine.setMetronome(on, volume);
      setSettings({ metronome: { on, volume } });
    },

    setMasterVolume(volume) {
      engine.setMasterVolume(volume);
      setSettings({ masterVolume: volume });
    },

    setTrack(id, params) {
      engine.setTrack(id, params);
      mixer = { ...mixer, [id]: { ...mixer[id], ...params } };
      set({ mixer });
    },

    previewTrack(id, params) {
      engine.previewTrack(id, params);
    },

    retry() {
      const { sounds, song, output } = playback.getState();
      if (output.status === 'error') {
        set({ output: { status: 'locked', error: undefined } });
        service.unlock();
      }
      if (sounds.status === 'error') bankLoad = undefined;
      if (doc && (sounds.status === 'error' || song.status === 'error')) {
        generation += 1;
        set({ song: { status: 'loading', error: undefined } });
        void track(loadDocument(generation));
      }
    },

    async settled() {
      while (inflight.size > 0) await Promise.all([...inflight]);
      await engine.settled();
    },

    debug() {
      return { engine };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      for (const cleanup of cleanups.splice(0)) cleanup();
      engine.dispose();
    },
  };
  return service;
}

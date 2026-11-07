import {
  ClickSynth,
  createAudioEngine,
  createSamplerSink,
  GM_BUDGET_BYTES,
  ManagedSampleSource,
  planInstruments,
  planSamples,
  Sampler,
  Sf2ParseError,
  Sf2Soundfont,
  type AudioEngine,
  type BufferFactory,
  type LoadOptions,
  type PlaybackState,
  type TempoMode,
  type Ticker,
  type TrackParams,
} from '@reprise/audio';
import type { Id, Score, Track } from '@reprise/model';

import { selectCanPlay, type PlaybackStore, type PlaybackStoreState } from '@/state/playback';
import type { BarRange } from '@/state/selection';

import { GmBank } from './gm-bank';
import { loadGmSoundfont, SoundfontError, type SoundfontLoader } from './soundfont-loader';
import { timelineNeutral } from './timeline-neutral';

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

export interface AudioServiceDebug {
  context?: BaseAudioContext;
  sampler?: Sampler;
  source?: ManagedSampleSource;
  engine?: AudioEngine;
  bank?: GmBank;
}

export interface AudioService {
  /** Creates the AudioContext on the first call, resumes a suspended one after. */
  unlock(): void;
  setDocument(document: OpenDocument | undefined): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  stop(): void;
  seek(tick: number): void;
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

// The manager needs no context: buffers built this way play in any context of their rate.
const CONSTRUCTED_BUFFERS: BufferFactory = {
  createBuffer: (numberOfChannels, length, sampleRate) =>
    new AudioBuffer({ numberOfChannels, length, sampleRate }),
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const isRunning = (state: PlaybackState) => state === 'playing' || state === 'counting-in';

function sameTuning(a: Track, b: Track): boolean {
  return (
    a.capo === b.capo &&
    a.tuning.length === b.tuning.length &&
    a.tuning.every((pitch, index) => pitch === b.tuning[index])
  );
}

export function createAudioService(options: AudioServiceOptions): AudioService {
  const {
    playback,
    loadSoundfont = loadGmSoundfont,
    createContext = () => new AudioContext({ latencyHint: 'interactive' }),
    budgetBytes = GM_BUDGET_BYTES,
    defer = (run) => setTimeout(run, 0),
  } = options;

  let context: BaseAudioContext | undefined;
  let sampler: Sampler | undefined;
  let engine: AudioEngine | undefined;
  let bank: GmBank | undefined;
  let bankLoad: Promise<GmBank> | undefined;
  let doc: OpenDocument | undefined;
  /** The score the sampler's tracks were last built from. */
  let attached: Score | undefined;
  let overrides: Record<Id, TrackParams> = {};
  let generation = 0;
  let transport: PlaybackState = 'stopped';
  let rebuildQueued = false;
  let disposed = false;
  // Per track, so a second instrument change drops the first one's progress writes.
  const loadTokens = new Map<Id, number>();
  const inflight = new Set<Promise<unknown>>();
  const cleanups: (() => void)[] = [];

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

  function baselineOf(score: Track): Required<TrackParams> {
    const { volume, pan, mute, solo } = score.channel;
    return { volume, pan, mute, solo, ...overrides[score.id] };
  }

  /**
   * Puts every strip back on its track's program and channel, with the user's overrides: a beat's
   * mixer change must not outlive the run it played in. With `at`, volume and pan are scheduled.
   */
  function resetBaseline(at?: number): void {
    if (!sampler || !bank || !attached) return;
    const held = new Set(sampler.trackIds);
    for (const scoreTrack of attached.tracks) {
      if (!held.has(scoreTrack.id)) continue;
      sampler.setInstrument(scoreTrack.id, bank.instrument(scoreTrack, scoreTrack.program), at);
      const params = baselineOf(scoreTrack);
      if (at === undefined) sampler.setTrack(scoreTrack.id, params);
      else sampler.setTrack(scoreTrack.id, { volume: params.volume, pan: params.pan }, { at });
    }
  }

  function attach(score: Score, mode: 'replace' | 'sync'): void {
    if (!sampler || !engine || !bank) return;
    const previous = mode === 'sync' ? attached : undefined;
    const before = new Map(previous?.tracks.map((t) => [t.id, t]));
    const ids = new Set(score.tracks.map((t) => t.id));
    for (const id of sampler.trackIds) {
      if (!previous || !ids.has(id)) sampler.removeTrack(id);
    }
    const held = new Set(sampler.trackIds);
    for (const scoreTrack of score.tracks) {
      const old = before.get(scoreTrack.id);
      const base = bank.instrument(scoreTrack, scoreTrack.program);
      if (!old || !held.has(scoreTrack.id) || !sameTuning(old, scoreTrack)) {
        sampler.addTrack(scoreTrack, base);
        const override = overrides[scoreTrack.id];
        if (override) sampler.setTrack(scoreTrack.id, override);
        continue;
      }
      if (old === scoreTrack) continue;
      if (
        old.program !== scoreTrack.program ||
        old.bank !== scoreTrack.bank ||
        old.kind !== scoreTrack.kind
      ) {
        sampler.setInstrument(scoreTrack.id, base);
      }
      if (old.channel !== scoreTrack.channel) {
        sampler.setTrack(scoreTrack.id, baselineOf(scoreTrack));
      }
    }
    attached = score;
    void engine.load(score, GM);
  }

  function loadSong(loaded: GmBank, score: Score, gen: number): Promise<void> {
    return track(
      loaded.source.load(score, loaded.regionMap, { instrumentOf: loaded.instrumentId }).then(
        (plan) => {
          if (gen === generation) set({ instruments: plan.instruments.length });
        },
        (error: unknown) => {
          if (gen === generation) set({ song: { status: 'error', error: messageOf(error) } });
        },
      ),
    );
  }

  function ensureBank(): Promise<GmBank> {
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
        const source = new ManagedSampleSource(font, CONSTRUCTED_BUFFERS, { budgetBytes });
        cleanups.push(
          source.on('memory', (memory) => {
            set({ memory });
          }),
        );
        set({ memory: source.memory() });
        bank = new GmBank(font, source);
        sounds({ status: 'ready', loaded: bytes.length, total: bytes.length, error: undefined });
        return bank;
      } catch (error) {
        sounds({ status: 'error', error: messageOf(error) });
        throw error;
      }
    })();
    return bankLoad;
  }

  async function loadDocument(gen: number): Promise<void> {
    try {
      const loaded = await ensureBank();
      if (gen !== generation || !doc) return;
      const { score } = doc;
      if (engine) attach(score, 'replace');
      const plan = await loaded.source.load(score, loaded.regionMap, {
        instrumentOf: loaded.instrumentId,
      });
      if (gen === generation) {
        set({ song: { status: 'ready', error: undefined }, instruments: plan.instruments.length });
      }
    } catch (error) {
      if (gen === generation) set({ song: { status: 'error', error: messageOf(error) } });
    }
  }

  const setLoad = (id: Id, load: { loaded: number; total: number } | undefined) => {
    const rest = Object.fromEntries(
      Object.entries(playback.getState().instrumentLoads).filter(([key]) => key !== id),
    );
    set({ instrumentLoads: load ? { ...rest, [id]: load } : rest });
  };

  /** Decodes one track's samples for its new instrument, counting them into `instrumentLoads`. */
  function loadInstrument(loaded: GmBank, score: Score, id: Id, gen: number): Promise<void> {
    const token = (loadTokens.get(id) ?? 0) + 1;
    loadTokens.set(id, token);
    const current = () => gen === generation && loadTokens.get(id) === token;
    const plan = planInstruments(score, { instrumentOf: loaded.instrumentId });
    const trackPlan = plan.tracks.find((entry) => entry.track === id);
    const refs = trackPlan
      ? planSamples({ instruments: plan.instruments, tracks: [trackPlan] }, loaded.regionMap)
      : [];
    if (refs.length === 0) {
      if (current()) setLoad(id, undefined);
      return Promise.resolve();
    }
    const total = refs.length;
    let count = 0;
    setLoad(id, { loaded: 0, total });
    return track(
      Promise.all(
        refs.map((ref) =>
          loaded.source.getBuffer(ref).then(() => {
            count += 1;
            if (current() && count < total) setLoad(id, { loaded: count, total });
          }),
        ),
      ).then(
        () => {
          if (current()) setLoad(id, undefined);
        },
        (error: unknown) => {
          if (!current()) return;
          setLoad(id, undefined);
          set({ song: { status: 'error', error: messageOf(error) } });
        },
      ),
    );
  }

  /** A timeline-neutral edit: channel and program changes go straight to the strips. */
  function applyTrackChanges(previous: Score, score: Score): void {
    if (!bank) return;
    if (sampler) attached = score;
    const held = new Set(sampler?.trackIds);
    const reprogrammed: Id[] = [];
    score.tracks.forEach((scoreTrack, index) => {
      const old = previous.tracks[index];
      if (!old || old === scoreTrack) return;
      if (old.program !== scoreTrack.program) reprogrammed.push(scoreTrack.id);
      if (!sampler || !held.has(scoreTrack.id) || !bank) return;
      if (old.channel !== scoreTrack.channel) {
        sampler.setTrack(scoreTrack.id, baselineOf(scoreTrack));
      }
      if (old.program !== scoreTrack.program) {
        sampler.setInstrument(scoreTrack.id, bank.instrument(scoreTrack, scoreTrack.program));
      }
    });
    if (reprogrammed.length === 0) return;
    void loadSong(bank, score, generation);
    for (const id of reprogrammed) void loadInstrument(bank, score, id, generation);
  }

  function rebuild(): void {
    if (!doc || !bank) return;
    const { score } = doc;
    if (engine) {
      const { position, settings } = playback.getState();
      const wasRunning = isRunning(transport);
      const wasPaused = transport === 'paused';
      const tick = position?.position.playbackTick ?? 0;
      attach(score, 'sync');
      if (wasRunning) {
        engine.setCountIn(false);
        engine.play(tick);
        engine.setCountIn(settings.countIn);
      } else if (wasPaused) {
        engine.seek(tick);
      }
    }
    void loadSong(bank, score, generation);
  }

  function scheduleRebuild(): void {
    if (rebuildQueued) return;
    rebuildQueued = true;
    void track(
      new Promise<void>((resolve) => {
        defer(() => {
          rebuildQueued = false;
          try {
            if (!disposed) rebuild();
          } finally {
            resolve();
          }
        });
      }),
    );
  }

  function close(): void {
    generation += 1;
    engine?.stop();
    if (sampler) for (const id of sampler.trackIds) sampler.removeTrack(id);
    // A song with no tracks plans no instruments, so the switch evicts every one.
    if (bank && doc) bank.source.switchSong({ ...doc.score, tracks: [] });
    doc = undefined;
    attached = undefined;
    overrides = {};
    loadTokens.clear();
    set({
      song: { status: 'idle', error: undefined },
      instruments: 0,
      position: undefined,
      mixer: {},
      instrumentLoads: {},
    });
  }

  function createEngine(created: BaseAudioContext): void {
    const live = new Sampler(created);
    const metronome = new ClickSynth(created, live.master.input);
    const sink = createSamplerSink(live, {
      instrumentOf: (scoreTrack, program) => bank?.instrument(scoreTrack, program),
    });
    const made = createAudioEngine({
      context: created,
      sink,
      // Through the bus, so clicks carry the limiter's pre-delay as the notes do.
      metronome,
      ...(options.scheduler && { scheduler: options.scheduler }),
      ...(options.frames && { frames: options.frames }),
      ...(options.startLatency !== undefined && { startLatency: options.startLatency }),
    });
    const { settings } = playback.getState();
    made.setTempo(settings.tempo.mode, settings.tempo.value);
    made.setCountIn(settings.countIn);
    made.setMetronome(settings.metronome.on, settings.metronome.volume);
    made.setLoop(settings.loop);
    live.master.gain = settings.masterVolume;
    sampler = live;
    engine = made;
    cleanups.push(
      made.on('state', (state) => {
        const previous = transport;
        transport = state;
        // The engine emits `state` before it replays the run's mixer changes, so they land on top.
        if (state === 'stopped' || (isRunning(state) && previous !== 'counting-in')) {
          resetBaseline();
        }
        set({ transport: state });
      }),
      made.on('position', (position) => {
        set({ position });
      }),
      made.on('loop', (loop) => {
        // Emitted before the next pass is scheduled, so its replayed changes win at `when`.
        resetBaseline(loop.when);
        set({ lastLoop: loop });
      }),
    );
  }

  const resume = () => {
    if (context instanceof AudioContext && context.state === 'suspended') void context.resume();
  };

  const service: AudioService = {
    unlock() {
      if (disposed) return;
      if (context) {
        resume();
        return;
      }
      let created: BaseAudioContext;
      try {
        created = createContext();
      } catch (error) {
        set({
          output: { status: 'error', error: `Audio output is unavailable: ${messageOf(error)}` },
        });
        return;
      }
      context = created;
      createEngine(created);
      set({ output: { status: 'ready', error: undefined } });
      if (bank && doc) attach(doc.score, 'replace');
      resume();
    },

    setDocument(next) {
      if (disposed) return;
      if (!next) {
        if (doc) close();
        return;
      }
      if (doc?.id === next.id) {
        if (doc.score === next.score) return;
        const previous = doc.score;
        doc = next;
        if (!rebuildQueued && timelineNeutral(previous, next.score)) {
          applyTrackChanges(previous, next.score);
        } else {
          scheduleRebuild();
        }
        return;
      }
      engine?.stop();
      engine?.setLoop(undefined);
      generation += 1;
      doc = next;
      overrides = {};
      loadTokens.clear();
      set({
        mixer: {},
        instrumentLoads: {},
        position: undefined,
        song: { status: 'loading', error: undefined },
        settings: { ...playback.getState().settings, loop: undefined },
      });
      void track(loadDocument(generation));
    },

    play() {
      service.unlock();
      if (!engine || !selectCanPlay(playback.getState())) return;
      engine.play();
    },

    pause() {
      engine?.pause();
    },

    togglePlay() {
      if (isRunning(transport)) service.pause();
      else service.play();
    },

    stop() {
      engine?.stop();
    },

    seek(tick) {
      if (!engine || !doc) return;
      // A seek during a count-in emits `playing` after `counting-in`, which skips the reset there.
      if (isRunning(transport)) resetBaseline();
      engine.seek(tick);
    },

    setTempo(mode, value) {
      engine?.setTempo(mode, value);
      setSettings({ tempo: { mode, value } });
    },

    setLoop(range) {
      engine?.setLoop(range);
      setSettings({ loop: range });
    },

    setCountIn(on) {
      engine?.setCountIn(on);
      setSettings({ countIn: on });
    },

    setMetronome(on, volume) {
      engine?.setMetronome(on, volume);
      setSettings({ metronome: { on, volume } });
    },

    setMasterVolume(volume) {
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw new RangeError(`setMasterVolume: volume must be 0 to 1, got ${String(volume)}`);
      }
      if (sampler) sampler.master.gain = volume;
      setSettings({ masterVolume: volume });
    },

    setTrack(id, params) {
      overrides = { ...overrides, [id]: { ...overrides[id], ...params } };
      set({ mixer: overrides });
      if (sampler?.trackIds.includes(id)) sampler.setTrack(id, params);
    },

    previewTrack(id, params) {
      if (sampler?.trackIds.includes(id)) sampler.setTrack(id, params);
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
      await bank?.source.settled();
    },

    debug() {
      return {
        ...(context && { context }),
        ...(sampler && { sampler }),
        ...(bank && { source: bank.source }),
        ...(engine && { engine }),
        ...(bank && { bank }),
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      for (const cleanup of cleanups.splice(0)) cleanup();
      engine?.dispose();
      sampler?.dispose();
      bank?.source.dispose();
      if (context instanceof AudioContext) void context.close();
    },
  };
  return service;
}

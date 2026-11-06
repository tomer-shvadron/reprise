import { positionAtSeconds, secondsAtTick } from '@reprise/model';
import type { Id, Note, PlaybackPosition, Score } from '@reprise/model';

import { ClickSynth } from './click-synth';
import type { TrackParams } from './sampler/sampler';
import { advance, retime, startRun, tickAtTime, withLoop } from './scheduler';
import type { Anchor, Run } from './scheduler';
import type { InstrumentSink, MetronomeSink } from './sink';
import { frameTicker, workerTicker } from './ticker';
import type { Ticker } from './ticker';
import { bpmAtTick, createTimeline, loopRange } from './timeline';
import type { TickRange, Timeline } from './timeline';

export type Unsubscribe = () => void;
export type InstrumentId = string;

/** Placeholder until the HQ tier (phase 3) defines how packs are assigned to tracks. */
export interface PackAssignment {
  trackId: Id;
  packId: Id;
  preset?: string;
}

export interface LoadOptions {
  tier: 'gm' | 'hq';
  packs: PackAssignment[];
}

export interface MemoryReport {
  decodedBytes: number;
  budgetBytes: number;
  residents: InstrumentId[];
}

export type PlaybackState = 'stopped' | 'counting-in' | 'playing' | 'paused';

export interface PositionEvent {
  /** Track 0, voice 0 for `beatIndex`; ask `positionAtSeconds` with `seconds` for another. */
  position: PlaybackPosition;
  masterBarId: Id;
  /** Seconds into the written tempo map, before percent or BPM scaling. */
  seconds: number;
  countingIn: boolean;
}

export interface LoopEvent {
  /** Completed passes of the loop, from 1. */
  pass: number;
  /** Context time of the wrap, up to the lookahead after the event fires. */
  when: number;
}

export interface AudioEngineEvents {
  position: PositionEvent;
  state: PlaybackState;
  loop: LoopEvent;
  memory: MemoryReport;
}

export type TempoMode = 'bpm' | 'percent';

export interface AudioEngine {
  load(score: Score, options: LoadOptions): Promise<void>;
  play(fromTick?: number): void;
  pause(): void;
  stop(): void;
  seek(tick: number): void;
  setTempo(mode: TempoMode, value: number): void;
  setLoop(range?: { startBar: Id; endBar: Id }): void;
  setCountIn(on: boolean): void;
  setMetronome(on: boolean, volume: number): void;
  setTrack(id: Id, params: TrackParams): void;
  previewNote(track: Id, note: Note): void;
  on<K extends keyof AudioEngineEvents>(
    event: K,
    handler: (payload: AudioEngineEvents[K]) => void,
  ): Unsubscribe;
  memory(): MemoryReport;
  dispose(): void;
}

export interface AudioEngineOptions {
  context: BaseAudioContext;
  sink: InstrumentSink;
  /** Defaults to a `ClickSynth` on the context's destination. */
  metronome?: MetronomeSink;
  /** Drives the lookahead scheduler; defaults to a 25 ms interval in a worker. */
  scheduler?: Ticker;
  /** Drives position events; defaults to animation frames. */
  frames?: Ticker;
  /** Seconds of audio scheduled ahead of `currentTime`; 0.2 by default. */
  lookahead?: number;
  /** Seconds between `play` or `seek` and the first sound; 0.03 by default. */
  startLatency?: number;
}

const DEFAULT_BUDGET_BYTES = 300 * 1024 * 1024;

function notYet(method: string, workPackage: string): Error {
  return new Error(`AudioEngine.${method} is not implemented yet; it arrives with ${workPackage}`);
}

export function createAudioEngine(options: AudioEngineOptions): AudioEngine {
  const { context, sink } = options;
  const metronome = options.metronome ?? new ClickSynth(context);
  const schedulerTicker = options.scheduler ?? workerTicker(25);
  const frames = options.frames ?? frameTicker();
  const lookahead = options.lookahead ?? 0.2;
  const startLatency = options.startLatency ?? 0.03;

  const handlers: { [K in keyof AudioEngineEvents]: Set<(payload: AudioEngineEvents[K]) => void> } =
    { position: new Set(), state: new Set(), loop: new Set(), memory: new Set() };
  let timeline: Timeline | undefined;
  let state: PlaybackState = 'stopped';
  let run: Run | undefined;
  let anchors: Anchor[] = [];
  /** Context time the run's first tick sounds: when a count-in ends. */
  let runStart = 0;
  let restTick = 0;
  let tempo: { mode: TempoMode; value: number } = { mode: 'percent', value: 100 };
  let rate = 1;
  let loopBars: { startBar: Id; endBar: Id } | undefined;
  let loop: TickRange | undefined;
  let countIn = false;
  let metronomeOn = false;
  let cancelScheduler: (() => void) | undefined;
  let cancelFrames: (() => void) | undefined;

  metronome.setVolume(0.7);

  function emit<K extends keyof AudioEngineEvents>(event: K, payload: AudioEngineEvents[K]): void {
    const set: Set<(payload: AudioEngineEvents[K]) => void> = handlers[event];
    for (const handler of [...set]) handler(payload);
  }

  function setState(next: PlaybackState): void {
    state = next;
    emit('state', next);
  }

  function requireTimeline(method: string): Timeline {
    if (!timeline) throw new Error(`AudioEngine.${method}: load a score first`);
    return timeline;
  }

  function clampTick(line: Timeline, tick: number): number {
    if (!Number.isFinite(tick)) throw new RangeError(`tick must be finite, got ${String(tick)}`);
    return Math.min(Math.max(tick, 0), Math.max(line.endTick - 1e-6, 0));
  }

  /** The anchor in effect at `time`; anchors it has superseded are dropped. */
  function anchorAt(time: number): Anchor | undefined {
    let index = 0;
    while (index + 1 < anchors.length && (anchors[index + 1]?.time ?? Infinity) <= time) {
      index += 1;
    }
    if (index > 0) anchors.splice(0, index);
    return anchors[0];
  }

  function currentTick(): number {
    if (!run || !timeline) return restTick;
    const anchor = anchorAt(context.currentTime);
    return anchor ? tickAtTime(timeline, anchor, context.currentTime) : restTick;
  }

  function emitPosition(): void {
    if (!timeline) return;
    const now = context.currentTime;
    const tick = currentTick();
    const seconds = secondsAtTick(timeline.map, tick);
    const position = positionAtSeconds(timeline.map, seconds);
    const masterBar = position && timeline.score.masterBars[position.masterBarIndex];
    if (!position || !masterBar) return;
    const countingIn = state === 'counting-in' && now < runStart;
    emit('position', { position, masterBarId: masterBar.id, seconds, countingIn });
  }

  function rateFor(tick: number): number {
    if (tempo.mode === 'percent') return 100 / tempo.value;
    return timeline ? bpmAtTick(timeline, tick) / tempo.value : 1;
  }

  function silence(when: number): void {
    sink.allNotesOff(when);
    metronome.silence(when);
  }

  function halt(): void {
    cancelScheduler?.();
    cancelFrames?.();
    cancelScheduler = undefined;
    cancelFrames = undefined;
    run = undefined;
    anchors = [];
  }

  function finish(): void {
    halt();
    restTick = loop?.startTick ?? 0;
    setState('stopped');
    emitPosition();
  }

  function pump(): void {
    if (!run || !timeline) return;
    const now = context.currentTime;
    for (;;) {
      const result = advance(timeline, run, {
        now,
        horizon: now + lookahead,
        metronome: metronomeOn,
      });
      run = result.run;
      anchors.push(...result.anchors);
      for (const click of result.clicks) metronome.click(click.when, click.accent);
      for (const mix of result.mixes) {
        sink.mix?.({
          track: mix.track,
          trackIndex: mix.trackIndex,
          voiceIndex: mix.voiceIndex,
          beat: mix.beat,
          beatIndex: mix.beatIndex,
          mix: mix.mix,
          when: mix.when,
          playbackTick: mix.tick,
          secondsPerTick: mix.secondsPerTick,
          sequenceIndex: mix.sequenceIndex,
          masterBarIndex: mix.masterBarIndex,
          passIndex: mix.passIndex,
        });
      }
      for (const note of result.notes) {
        sink.noteOn({
          track: note.track,
          trackIndex: note.trackIndex,
          voiceIndex: note.voiceIndex,
          beat: note.beat,
          beatIndex: note.beatIndex,
          note: note.note,
          when: note.when,
          duration: note.duration,
          playbackTick: note.tick,
          durationTicks: note.durationTicks,
          sequenceIndex: note.sequenceIndex,
          masterBarIndex: note.masterBarIndex,
          passIndex: note.passIndex,
          barEnd: note.barEnd,
          nextOnString: note.nextOnString,
          continuations: note.continuations,
        });
      }
      if (!result.loop) break;
      emit('loop', result.loop);
      if (!isRunning()) return;
    }
    if (state === 'counting-in' && now >= runStart) setState('playing');
    if (run.finished && run.endTime !== undefined && now >= run.endTime) finish();
  }

  function frame(): void {
    if (state === 'counting-in' && context.currentTime >= runStart) setState('playing');
    emitPosition();
  }

  function begin(line: Timeline, tick: number, withCountIn: boolean): void {
    run = startRun(line, {
      tick,
      time: context.currentTime + startLatency,
      rate,
      loop,
      countIn: withCountIn,
    });
    anchors = [run.anchor];
    runStart = run.anchor.time;
    cancelScheduler ??= schedulerTicker(pump);
    cancelFrames ??= frames(frame);
  }

  function isRunning(): boolean {
    return state === 'playing' || state === 'counting-in';
  }

  const engine: AudioEngine = {
    load(score) {
      if (isRunning()) {
        silence(context.currentTime);
        halt();
      }
      timeline = createTimeline(score);
      restTick = 0;
      try {
        loop = loopBars ? loopRange(timeline, loopBars, 0) : undefined;
      } catch {
        loopBars = undefined;
        loop = undefined;
      }
      rate = rateFor(0);
      if (state !== 'stopped') setState('stopped');
      emitPosition();
      return Promise.resolve();
    },

    play(fromTick) {
      const line = requireTimeline('play');
      if (isRunning()) {
        if (fromTick !== undefined) engine.seek(fromTick);
        return;
      }
      let tick = clampTick(line, fromTick ?? restTick);
      if (loop && (tick < loop.startTick || tick >= loop.endTick)) tick = loop.startTick;
      if (context instanceof AudioContext && context.state === 'suspended') void context.resume();
      begin(line, tick, countIn);
      setState(countIn ? 'counting-in' : 'playing');
      pump();
      emitPosition();
    },

    pause() {
      if (!isRunning()) return;
      restTick = currentTick();
      silence(context.currentTime);
      halt();
      setState('paused');
      emitPosition();
    },

    stop() {
      if (isRunning()) silence(context.currentTime);
      halt();
      restTick = loop?.startTick ?? 0;
      setState('stopped');
      emitPosition();
    },

    seek(tick) {
      const line = requireTimeline('seek');
      const target = clampTick(line, tick);
      if (isRunning()) {
        silence(context.currentTime);
        begin(line, target, false);
        setState('playing');
        pump();
      } else {
        restTick = target;
        setState(state);
      }
      emitPosition();
    },

    setTempo(mode, value) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`setTempo: value must be a positive number, got ${String(value)}`);
      }
      tempo = { mode, value };
      rate = rateFor(currentTick());
      if (run && timeline) {
        run = retime(timeline, run, rate);
        anchors.push(run.anchor);
      }
    },

    setLoop(range) {
      loopBars = range;
      if (!range) loop = undefined;
      else if (timeline) loop = loopRange(timeline, range, currentTick());
      if (run) run = withLoop(run, loop);
    },

    setCountIn(on) {
      countIn = on;
    },

    setMetronome(on, volume) {
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw new RangeError(`setMetronome: volume must be 0 to 1, got ${String(volume)}`);
      }
      metronomeOn = on;
      metronome.setVolume(volume);
      if (!on) metronome.silence(context.currentTime);
    },

    setTrack() {
      throw notYet('setTrack', 'the sampler (WP-031)');
    },

    previewNote() {
      throw notYet('previewNote', 'the sampler (WP-031)');
    },

    on(event, handler) {
      const set: Set<(payload: AudioEngineEvents[typeof event]) => void> = handlers[event];
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },

    memory() {
      return { decodedBytes: 0, budgetBytes: DEFAULT_BUDGET_BYTES, residents: [] };
    },

    dispose() {
      if (isRunning()) silence(context.currentTime);
      halt();
      for (const set of Object.values(handlers)) set.clear();
      sink.dispose?.();
      metronome.dispose?.();
      state = 'stopped';
      timeline = undefined;
    },
  };
  return engine;
}

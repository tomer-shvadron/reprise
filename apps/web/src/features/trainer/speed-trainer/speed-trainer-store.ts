import { bpmAtTick, loopRange } from '@reprise/audio';
import { create } from 'zustand';

import type { AppServices } from '@/app/services';
import { clampPercent } from '@/features/transport';
import type { BarRange } from '@/state/selection';
import { timelineOf, writtenBpmAt } from '@/state/timeline';

import {
  DEFAULT_CONFIG,
  onPass,
  percentPlan,
  REPS,
  startRun,
  type RampConfig,
  type RampPlan,
} from './ramp';

export type SpeedTrainerStatus = 'idle' | 'running' | 'held' | 'done';

export type SpeedTrainerServices = Pick<
  AppServices,
  'audio' | 'playback' | 'document' | 'practice' | 'transport' | 'ui'
>;

export interface SpeedTrainerState {
  config: RampConfig;
  status: SpeedTrainerStatus;
  /** The loop the run is bound to, as it was at Start. */
  range: BarRange | undefined;
  /** The written tempo at the loop's first tick; BPM settings are read against it. */
  referenceBpm: number | undefined;
  plan: RampPlan | undefined;
  stepIndex: number;
  reps: number;
  missed: boolean;
  /** Changes the setup; ignored while a run is in progress. */
  setConfig(config: Partial<RampConfig>): void;
  start(): void;
  hold(): void;
  resume(): void;
  /** Start, hold or resume, by state. */
  toggle(): void;
  /** Marks the pass in progress missed. */
  markMissed(): void;
  reset(): void;
}

const sameRange = (a: BarRange, b: BarRange | undefined) =>
  b !== undefined && a.startBar === b.startBar && a.endBar === b.endBar;

/**
 * The written tempo at the first tick of `range`, where the ramp's BPM values are anchored; at
 * the playhead when there is no loop yet, and 120 with no score.
 */
export function referenceBpmFor(
  services: Pick<SpeedTrainerServices, 'document' | 'playback'>,
  range: BarRange | undefined,
): number {
  const { score } = services.document.getState();
  if (!score) return 120;
  const timeline = timelineOf(score);
  const { position } = services.playback.getState();
  if (!range) return writtenBpmAt(timeline, position);
  try {
    const near = position?.position.playbackTick ?? 0;
    return bpmAtTick(timeline, loopRange(timeline, range, near).startTick);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return writtenBpmAt(timeline, position);
  }
}

export function createSpeedTrainer(services: SpeedTrainerServices) {
  const { audio, playback, document, practice, transport, ui } = services;
  const announce = (text: string) => {
    transport.getState().announce(text);
  };
  const say = (percent: number) => {
    announce(`Speed trainer: ${String(Math.round(percent))} percent`);
  };

  // Set around the trainer's own `setTempo`, so its listener tells it from the user's.
  let applying = false;
  // The loop event already counted; the store can notify the same change more than once.
  let handled = playback.getState().lastLoop;
  let stopListening: (() => void) | undefined;

  const store = create<SpeedTrainerState>()((set, get) => {
    const setTempo = (percent: number) => {
      applying = true;
      try {
        audio.setTempo('percent', percent);
      } finally {
        applying = false;
      }
    };

    const end = (status: 'idle' | 'done', message?: string) => {
      stopListening?.();
      stopListening = undefined;
      set(status === 'idle' ? { status, stepIndex: 0, reps: 0, missed: false } : { status });
      if (message) announce(message);
    };

    // The step is applied from inside the loop event's notification, never later: the engine has
    // already scheduled the next pass at the old tempo by the time a microtask, timer or React
    // effect would run, and the change would land mid-bar. See the README.
    const onPlayback = (state: ReturnType<typeof playback.getState>, previous: typeof state) => {
      const { status, range, plan, config } = get();
      if (!range || !plan || (status !== 'running' && status !== 'held')) return;
      if (!sameRange(range, state.settings.loop)) {
        end('idle', 'Loop changed: speed trainer reset');
        return;
      }
      if (!applying && status === 'running' && state.settings.tempo !== previous.settings.tempo) {
        set({ status: 'held' });
        announce('Speed trainer held: tempo changed');
        return;
      }
      const loop = state.lastLoop;
      if (!loop || loop === handled) return;
      handled = loop;
      if (status !== 'running') return;

      const result = onPass(
        { stepIndex: get().stepIndex, reps: get().reps, missed: get().missed },
        plan,
        config,
      );
      if (result.completed !== undefined) practice.getState().recordStep(range, result.completed);
      set(result.run);
      if (result.setPercent !== undefined) {
        setTempo(result.setPercent);
        say(result.setPercent);
      }
      if (result.done) end('done', 'Speed trainer: target reached');
    };

    const listen = () => {
      stopListening?.();
      const stopPlayback = playback.subscribe(onPlayback);
      const stopDocument = document.subscribe((state, previous) => {
        if (state.id !== previous.id) end('idle', 'Speed trainer reset');
      });
      stopListening = () => {
        stopPlayback();
        stopDocument();
      };
    };

    return {
      config: DEFAULT_CONFIG,
      status: 'idle',
      range: undefined,
      referenceBpm: undefined,
      plan: undefined,
      stepIndex: 0,
      reps: 0,
      missed: false,

      setConfig(partial) {
        const { status, config } = get();
        if (status === 'running' || status === 'held') return;
        const next = { ...config, ...partial };
        next.repsPerStep = Math.min(REPS.max, Math.max(REPS.min, Math.round(next.repsPerStep)));
        set({ config: next });
      },

      start() {
        const { score } = document.getState();
        const range = playback.getState().settings.loop;
        ui.getState().showPanelView('speedTrainer');
        if (!score || !range) {
          announce('Loop some bars first');
          return;
        }
        const { config } = get();
        const referenceBpm = referenceBpmFor(services, range);
        const plan = percentPlan(config, referenceBpm);
        const first = plan.percents[0] ?? 100;
        handled = playback.getState().lastLoop;
        set({ status: 'running', range, referenceBpm, plan, ...startRun() });
        practice.getState().noteLoop(range);
        listen();
        // From the top, so the first pass is a whole one and the count-in, if on, plays once.
        audio.stop();
        setTempo(first);
        audio.play();
        say(first);
      },

      hold() {
        if (get().status !== 'running') return;
        set({ status: 'held' });
        announce('Speed trainer held');
      },

      resume() {
        const { status, plan, stepIndex } = get();
        if (status !== 'held' || !plan) return;
        set({ status: 'running' });
        // The user may have moved the tempo while it was held.
        const percent = plan.percents[stepIndex];
        if (percent !== undefined) setTempo(percent);
        announce('Speed trainer resumed');
      },

      toggle() {
        const { status } = get();
        if (status === 'running') get().hold();
        else if (status === 'held') get().resume();
        else get().start();
      },

      markMissed() {
        if (get().status !== 'running') return;
        set({ missed: true });
        announce('Pass marked missed');
      },

      reset() {
        const { status, plan } = get();
        if (status === 'idle') return;
        end('idle');
        const first = plan?.percents[0];
        if (first !== undefined) setTempo(clampPercent(first));
        announce('Speed trainer reset');
      },
    };
  });
  return store;
}

export type SpeedTrainerStore = ReturnType<typeof createSpeedTrainer>;

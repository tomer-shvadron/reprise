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
  let applying = 0;
  // The loop event already counted; the store can notify the same change more than once.
  let handled = playback.getState().lastLoop;
  // The tempo the trainer last set, so a different one is the user's, whatever the notification's
  // `previous` is (a nested change hands later listeners the outer one).
  let applied: number | undefined;
  // The document a run belongs to.
  let documentId = document.getState().id;
  let stopListening: (() => void) | undefined;

  const store = create<SpeedTrainerState>()((set, get) => {
    // Notifications raised inside `run` are the trainer's own, whatever they carry.
    const quietly = (run: () => void) => {
      applying += 1;
      try {
        run();
      } finally {
        applying -= 1;
      }
    };
    const setTempo = (percent: number) => {
      applied = percent;
      quietly(() => {
        audio.setTempo('percent', percent);
      });
    };

    // Back to idle, dropping the listeners. A finished run keeps them until a loop or document
    // change, so the panel never shows a stale run.
    const end = (message?: string) => {
      stopListening?.();
      stopListening = undefined;
      set({ status: 'idle', stepIndex: 0, reps: 0, missed: false });
      if (message) announce(message);
    };

    // The step is applied from inside the loop event's notification, never later: the engine has
    // already scheduled the next pass at the old tempo by the time a microtask, timer or React
    // effect would run, and the change would land mid-bar. See the README.
    const onPlayback = (state: ReturnType<typeof playback.getState>) => {
      const { status, range, plan, config } = get();
      if (!range || !plan || status === 'idle') return;
      // Before the tempo check: a new song brings its own tempo reset.
      if (document.getState().id !== documentId) {
        end('Speed trainer reset');
        return;
      }
      if (!sameRange(range, state.settings.loop)) {
        end('Loop changed: speed trainer reset');
        return;
      }
      const loop = state.lastLoop;
      const fresh = loop !== undefined && loop !== handled;
      if (fresh) handled = loop;
      const { tempo } = state.settings;
      if (
        status === 'running' &&
        applying === 0 &&
        (tempo.mode !== 'percent' || tempo.value !== applied)
      ) {
        set({ status: 'held' });
        announce('Speed trainer held: tempo changed');
        return;
      }
      if (!fresh || status !== 'running') return;

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
      if (result.done) {
        set({ status: 'done' });
        announce('Speed trainer: target reached');
      }
    };

    const listen = () => {
      stopListening?.();
      const stopPlayback = playback.subscribe(onPlayback);
      const stopDocument = document.subscribe((state, previous) => {
        if (state.id !== previous.id) end('Speed trainer reset');
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
        // From the practice mode the capsule shows it, and a panel would end the mode.
        if (!ui.getState().practiceMode.on) ui.getState().showPanelView('speedTrainer');
        if (!score || !range) {
          announce('Loop some bars first');
          return;
        }
        const { config } = get();
        const referenceBpm = referenceBpmFor(services, range);
        const plan = percentPlan(config, referenceBpm);
        const first = plan.percents[0] ?? 100;
        // The trainer runs in percent, so starting it leaves fixed tempo.
        const wasFixed = playback.getState().settings.tempo.mode === 'bpm';
        handled = playback.getState().lastLoop;
        documentId = document.getState().id;
        set({ status: 'running', range, referenceBpm, plan, ...startRun() });
        practice.getState().noteLoop(range);
        listen();
        // From the top, so the first pass is a whole one and the count-in, if on, plays once.
        quietly(() => {
          audio.stop();
          setTempo(first);
          audio.play();
        });
        if (wasFixed) {
          transport.getState().setFixedReturn(undefined);
          announce(`Fixed tempo off. Speed trainer: ${String(Math.round(first))} percent`);
        } else say(first);
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
        end();
        const first = plan?.percents[0];
        if (first !== undefined) setTempo(clampPercent(first));
        announce('Speed trainer reset');
      },
    };
  });
  return store;
}

export type SpeedTrainerStore = ReturnType<typeof createSpeedTrainer>;

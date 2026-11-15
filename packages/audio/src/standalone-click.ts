import type { MetronomeSink } from './sink';
import { workerTicker } from './ticker';
import type { Ticker } from './ticker';

/** What the standalone click plays. The beat is the unit `bpm` counts: a quarter, as a metronome does. */
export interface ClickSettings {
  /** Beats per minute, 10 to 400. */
  bpm: number;
  /** Beats in a bar, 1 to 32. */
  beatsPerBar: number;
  /** Which beats are stressed, by position in the bar; beats past its end are not, and empty means none. `[true]` stresses the downbeat. */
  accents: readonly boolean[];
  /** Clicks per beat: 1 (quarters), 2 (eighths), 3 (triplets) or 4 (sixteenths). */
  subdivision: 1 | 2 | 3 | 4;
  /** 0 to 1. */
  volume: number;
}

export const DEFAULT_CLICK_SETTINGS: ClickSettings = {
  bpm: 100,
  beatsPerBar: 4,
  accents: [true],
  subdivision: 1,
  volume: 0.7,
};

export const CLICK_BPM_RANGE = { min: 10, max: 400 } as const;
export const CLICK_MAX_BEATS = 32;

export function checkClickSettings(method: string, settings: ClickSettings): void {
  const { bpm, beatsPerBar, subdivision, volume } = settings;
  if (!Number.isFinite(bpm) || bpm < CLICK_BPM_RANGE.min || bpm > CLICK_BPM_RANGE.max) {
    throw new RangeError(
      `${method}: bpm must be ${String(CLICK_BPM_RANGE.min)} to ${String(CLICK_BPM_RANGE.max)}, got ${String(bpm)}`,
    );
  }
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > CLICK_MAX_BEATS) {
    throw new RangeError(
      `${method}: beatsPerBar must be a whole number from 1 to ${String(CLICK_MAX_BEATS)}, got ${String(beatsPerBar)}`,
    );
  }
  if (![1, 2, 3, 4].includes(subdivision)) {
    throw new RangeError(`${method}: subdivision must be 1, 2, 3 or 4, got ${String(subdivision)}`);
  }
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new RangeError(`${method}: volume must be 0 to 1, got ${String(volume)}`);
  }
}

export interface StandaloneClickOptions {
  context: { readonly currentTime: number };
  sink: MetronomeSink;
  /** Drives the lookahead; a 25 ms interval in a worker by default. */
  scheduler?: Ticker;
  /** Seconds scheduled ahead of `currentTime`; 0.2 by default, as the transport's. */
  lookahead?: number;
  /** Seconds between `start` and the first click; 0.03 by default. */
  startLatency?: number;
}

/**
 * A click with no score, on the transport's lookahead clock: the position is a beat counter, not a
 * tick, so there is no timeline to build.
 *
 * A new `bpm` applies from the next click scheduled (the gap after it is already the new one), and
 * `beatsPerBar`, `accents` and `subdivision` from the next beat boundary, so a change never cuts a
 * bar or a beat short. The volume applies at once.
 */
export interface StandaloneClick {
  readonly running: boolean;
  readonly settings: ClickSettings;
  start(settings?: ClickSettings): void;
  /** Applies new settings, or keeps them for the next `start` when stopped. */
  update(settings: ClickSettings): void;
  stop(): void;
  dispose(): void;
}

export function createStandaloneClick(options: StandaloneClickOptions): StandaloneClick {
  const { context, sink } = options;
  const ticker = options.scheduler ?? workerTicker(25);
  const lookahead = options.lookahead ?? 0.2;
  const startLatency = options.startLatency ?? 0.03;

  let settings = DEFAULT_CLICK_SETTINGS;
  /** What the beat in progress plays: `settings` as of its first click. */
  let beat = settings;
  let stopTicking: (() => void) | undefined;
  let next = 0;
  let beatIndex = 0;
  let sub = 0;

  function pump(): void {
    const horizon = context.currentTime + lookahead;
    while (next < horizon) {
      if (sub === 0) beat = settings;
      // A stalled page skips what it can no longer play, keeping the bar's phase.
      if (next >= context.currentTime) {
        const position = beatIndex % beat.beatsPerBar;
        const stressed = sub === 0 && (beat.accents[position] ?? false);
        sink.click(next, stressed, sub !== 0);
      }
      next += 60 / settings.bpm / beat.subdivision;
      sub += 1;
      if (sub >= beat.subdivision) {
        sub = 0;
        beatIndex += 1;
      }
    }
  }

  const click: StandaloneClick = {
    get running() {
      return stopTicking !== undefined;
    },
    get settings() {
      return settings;
    },
    start(initial) {
      if (initial) {
        checkClickSettings('startClick', initial);
        settings = initial;
      }
      if (stopTicking) return;
      sink.setVolume(settings.volume);
      next = context.currentTime + startLatency;
      beatIndex = 0;
      sub = 0;
      stopTicking = ticker(pump);
      pump();
    },
    update(updated) {
      checkClickSettings('updateClick', updated);
      settings = updated;
      sink.setVolume(updated.volume);
    },
    stop() {
      if (!stopTicking) return;
      stopTicking();
      stopTicking = undefined;
      sink.silence(context.currentTime);
    },
    dispose() {
      click.stop();
      sink.dispose?.();
    },
  };
  return click;
}

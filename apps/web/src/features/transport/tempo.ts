import type { TransportSettings } from '@/state/playback';

/** The speed range in percent of the written tempo; keyboard steps snap to the `step` grid. */
export const TEMPO_PERCENT = { min: 25, max: 200, default: 100, step: 5 } as const;

export function clampPercent(percent: number): number {
  return Math.min(TEMPO_PERCENT.max, Math.max(TEMPO_PERCENT.min, percent));
}

/** The speed in percent, whichever mode the setting was written in. */
export function percentOf(tempo: TransportSettings['tempo'], written: number): number {
  return tempo.mode === 'percent' ? tempo.value : (tempo.value / written) * 100;
}

export function bpmFor(percent: number, written: number): number {
  return Math.round((written * percent) / 100);
}

export function percentForBpm(bpm: number, written: number): number {
  return clampPercent((bpm / written) * 100);
}

/** One keyboard step down or up, landing on the 5% grid: 77% steps to 75% or 80%. */
export function stepPercent(percent: number, direction: -1 | 1): number {
  const { step } = TEMPO_PERCENT;
  const next =
    direction < 0
      ? Math.ceil(percent / step) * step - step
      : Math.floor(percent / step) * step + step;
  return clampPercent(next);
}

const BPM_TEXT = /^\d{1,3}(\.\d+)?$/;

export function parseBpm(text: string): number | undefined {
  const trimmed = text.trim();
  if (!BPM_TEXT.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value > 0 ? value : undefined;
}

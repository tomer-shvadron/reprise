import { TEMPO_PERCENT } from '@/features/transport';

export type RampUnit = 'percent' | 'bpm';
export type OnMiss = 'repeat' | 'stepDown';

/** What the user sets up; start, step and target are in `unit`. */
export interface RampConfig {
  unit: RampUnit;
  start: number;
  step: number;
  target: number;
  repsPerStep: number;
  onMiss: OnMiss;
}

export const REPS = { min: 1, max: 20 } as const;

export const DEFAULT_CONFIG: RampConfig = {
  unit: 'percent',
  start: 70,
  step: 5,
  target: 100,
  repsPerStep: 2,
  onMiss: 'repeat',
};

/** The ramp in percent of the written tempo, which is what the engine runs in. */
export interface RampPlan {
  /** Every step's exact percent, first to last; the last is the target. */
  percents: readonly number[];
}

/** Where a run stands: the step it plays, the clean passes it has made at that step. */
export interface RampRun {
  stepIndex: number;
  reps: number;
  /** The pass in progress was marked missed. */
  missed: boolean;
}

export const startRun = (): RampRun => ({ stepIndex: 0, reps: 0, missed: false });

const clamp = (percent: number) =>
  Math.min(TEMPO_PERCENT.max, Math.max(TEMPO_PERCENT.min, percent));

const EPSILON = 1e-9;

/** Converts a value of `unit` to percent; a BPM value is against the reference tempo. */
export function toPercent(value: number, unit: RampUnit, referenceBpm: number): number {
  return unit === 'percent' ? value : (value / referenceBpm) * 100;
}

/**
 * The steps `start, start ± step, …`, with the last clamped to `target` so it never overshoots.
 * Start and target are clamped to the engine's range; a ramp from below `target` goes up, from
 * above it goes down, and equal ends make one step.
 */
export function percentPlan(config: RampConfig, referenceBpm: number): RampPlan {
  const start = clamp(toPercent(config.start, config.unit, referenceBpm));
  const target = clamp(toPercent(config.target, config.unit, referenceBpm));
  const step = Math.max(toPercent(config.step, config.unit, referenceBpm), 0.01);
  const distance = Math.abs(target - start);
  const count = Math.ceil(distance / step - EPSILON) + 1;
  const direction = target >= start ? 1 : -1;
  const percents = Array.from({ length: Math.max(count, 1) }, (_, index) =>
    index === count - 1 ? target : start + direction * step * index,
  );
  return { percents };
}

export interface PassResult {
  run: RampRun;
  /** The tempo to apply now, when the step changed. */
  setPercent?: number;
  /** A step finished cleanly at this percent. */
  completed?: number;
  /** The completed step was the last one. */
  done?: boolean;
}

/** What one finished pass of the loop does to a running ramp. */
export function onPass(run: RampRun, plan: RampPlan, config: RampConfig): PassResult {
  const { percents } = plan;
  const at = (index: number) => percents[index] ?? percents.at(-1) ?? 100;
  if (run.missed) {
    const back = config.onMiss === 'stepDown' && run.stepIndex > 0;
    const stepIndex = back ? run.stepIndex - 1 : run.stepIndex;
    const cleared = { stepIndex, reps: 0, missed: false };
    return back ? { run: cleared, setPercent: at(stepIndex) } : { run: cleared };
  }
  const reps = run.reps + 1;
  if (reps < config.repsPerStep) return { run: { ...run, reps } };
  const completed = at(run.stepIndex);
  if (run.stepIndex >= percents.length - 1) {
    return { run: { stepIndex: run.stepIndex, reps, missed: false }, done: true, completed };
  }
  const stepIndex = run.stepIndex + 1;
  return { run: { stepIndex, reps: 0, missed: false }, setPercent: at(stepIndex), completed };
}

/** A value for a field, in the unit it is shown in: whole BPM, percent to one decimal. */
export function formatValue(percent: number, unit: RampUnit, referenceBpm: number): string {
  return unit === 'percent'
    ? String(Math.round(percent * 10) / 10)
    : String(Math.round((referenceBpm * percent) / 100));
}

/** The same ramp setting expressed in the other unit, for the Percent | BPM toggle. */
export function convertConfig(
  config: RampConfig,
  unit: RampUnit,
  referenceBpm: number,
): RampConfig {
  if (config.unit === unit) return config;
  const convert = (value: number) => {
    const percent = toPercent(value, config.unit, referenceBpm);
    return unit === 'percent'
      ? Math.round(percent * 10) / 10
      : Math.round((referenceBpm * percent) / 100);
  };
  return {
    ...config,
    unit,
    start: convert(config.start),
    step: Math.max(convert(config.step), 1),
    target: convert(config.target),
  };
}

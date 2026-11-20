import { describe, expect, it } from 'vitest';

import {
  convertConfig,
  DEFAULT_CONFIG,
  onPass,
  percentPlan,
  rampProgress,
  startRun,
  type RampConfig,
} from './ramp';

const config = (partial: Partial<RampConfig> = {}): RampConfig => ({
  ...DEFAULT_CONFIG,
  ...partial,
});

describe('percentPlan', () => {
  it('steps from start to target and clamps the last step to the target', () => {
    expect(percentPlan(config({ start: 70, step: 5, target: 100 }), 120).percents).toEqual([
      70, 75, 80, 85, 90, 95, 100,
    ]);
    expect(percentPlan(config({ start: 70, step: 20, target: 100 }), 120).percents).toEqual([
      70, 90, 100,
    ]);
  });

  it('ramps down when the target is below the start', () => {
    expect(percentPlan(config({ start: 100, step: 10, target: 80 }), 120).percents).toEqual([
      100, 90, 80,
    ]);
  });

  it('makes one step when start equals target', () => {
    expect(percentPlan(config({ start: 90, target: 90 }), 120).percents).toEqual([90]);
  });

  it('reads BPM values against the reference tempo and keeps the percent exact', () => {
    const plan = percentPlan(config({ unit: 'bpm', start: 60, step: 20, target: 80 }), 80);
    expect(plan.percents).toEqual([75, 100]);
    const odd = percentPlan(config({ unit: 'bpm', start: 50, step: 10, target: 70 }), 120);
    expect(odd.percents[0]).toBeCloseTo(41.6667, 3);
    expect(odd.percents.at(-1)).toBeCloseTo(58.3333, 3);
    expect(odd.percents).toHaveLength(3);
  });

  it('clamps to the engine range of 25 to 200 percent', () => {
    const plan = percentPlan(config({ start: 10, step: 100, target: 400 }), 120);
    expect(plan.percents).toEqual([25, 125, 200]);
  });
});

describe('onPass', () => {
  const plan = percentPlan(config({ start: 70, step: 10, target: 90 }), 120);
  const twice = config({ repsPerStep: 2 });

  it('counts clean passes and completes a step on the last one', () => {
    const first = onPass(startRun(), plan, twice);
    expect(first).toEqual({ run: { stepIndex: 0, reps: 1, missed: false } });
    const second = onPass(first.run, plan, twice);
    expect(second.run).toEqual({ stepIndex: 1, reps: 0, missed: false });
    expect(second.setPercent).toBe(80);
    expect(second.completed).toBe(70);
    expect(second.done).toBeUndefined();
  });

  it('is done after the last step completes, recording it', () => {
    const result = onPass({ stepIndex: 2, reps: 1, missed: false }, plan, twice);
    expect(result.done).toBe(true);
    expect(result.completed).toBe(90);
    expect(result.setPercent).toBeUndefined();
  });

  it('repeats the step after a miss, with the count back to zero', () => {
    const result = onPass({ stepIndex: 1, reps: 1, missed: true }, plan, twice);
    expect(result).toEqual({ run: { stepIndex: 1, reps: 0, missed: false } });
  });

  it('steps down after a miss, never below the start', () => {
    const down = config({ onMiss: 'stepDown' });
    const back = onPass({ stepIndex: 1, reps: 1, missed: true }, plan, down);
    expect(back.run.stepIndex).toBe(0);
    expect(back.setPercent).toBe(70);
    expect(back.completed).toBeUndefined();
    const atStart = onPass({ stepIndex: 0, reps: 1, missed: true }, plan, down);
    expect(atStart.run.stepIndex).toBe(0);
    expect(atStart.setPercent).toBeUndefined();
  });
});

describe('convertConfig', () => {
  it('converts between units against the reference tempo and back', () => {
    const bpm = convertConfig(config({ start: 50, step: 10, target: 100 }), 'bpm', 120);
    expect(bpm).toMatchObject({ unit: 'bpm', start: 60, step: 12, target: 120 });
    const back = convertConfig(bpm, 'percent', 120);
    expect(back.start).toBeCloseTo(50, 9);
    expect(back.step).toBeCloseTo(10, 9);
    expect(back.target).toBeCloseTo(100, 9);
  });

  it('round-trips losslessly where a BPM step is not a whole number', () => {
    const original = config({ start: 70, step: 5, target: 100 });
    const back = convertConfig(convertConfig(original, 'bpm', 90), 'percent', 90);
    expect(back.step).toBeCloseTo(5, 9);
    expect(percentPlan(back, 90).percents).toEqual(percentPlan(original, 90).percents);
  });
});

describe('rampProgress', () => {
  it('runs from 0 to 1 over an ascending plan', () => {
    const plan = { percents: [70, 80, 90, 100] };
    expect(rampProgress(plan, 0, 'running')).toBe(0);
    expect(rampProgress(plan, 1, 'running')).toBeCloseTo(1 / 3);
    expect(rampProgress(plan, 3, 'running')).toBe(1);
  });

  it('runs from 0 to 1 over a descending plan', () => {
    const plan = { percents: [100, 90, 80] };
    expect(rampProgress(plan, 0, 'running')).toBe(0);
    expect(rampProgress(plan, 1, 'held')).toBe(0.5);
    expect(rampProgress(plan, 2, 'running')).toBe(1);
  });

  it('is 0 for a single step until the run is done', () => {
    const plan = { percents: [80] };
    expect(rampProgress(plan, 0, 'running')).toBe(0);
    expect(rampProgress(plan, 0, 'done')).toBe(1);
  });

  it('is 0 without a plan', () => {
    expect(rampProgress(undefined, 0, 'idle')).toBe(0);
  });
});

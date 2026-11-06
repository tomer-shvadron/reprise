import { describe, expect, it } from 'vitest';

import { status, type Outcome } from './budget-reporter.ts';
import type { ResolvedBudget } from './budgets.ts';

const bench: ResolvedBudget = {
  metric: 'Cold',
  value: 250,
  unit: 'ms',
  assertedBy: { kind: 'bench', path: 'a/b.bench.ts' },
  factor: 1,
  threshold: 250,
};

const ran = (measured: number, state: string, enforced = true, retried = false): Outcome => ({
  result: { metric: 'Cold', measured, enforced, ...(enforced ? {} : { until: 'WP-027' }) },
  state,
  retried,
});

describe('status', () => {
  it('names the unit test or the work package for a row the bench does not measure', () => {
    expect(status({ ...bench, assertedBy: { kind: 'unit', path: 'a/c.test.ts' } }, undefined)).toBe(
      'unit: a/c.test.ts',
    );
    expect(
      status({ ...bench, assertedBy: { kind: 'pending', workPackage: 'WP-055' } }, undefined),
    ).toBe('pending: WP-055');
  });

  it('reads a bench that never ran as not run, and one that threw before measuring as fail', () => {
    expect(status(bench, undefined)).toBe('not run');
    expect(status(bench, { state: 'failed', retried: true })).toBe('fail');
  });

  it('reports a bench that is not enforced yet as under or over its threshold', () => {
    expect(status(bench, ran(200, 'passed', false))).toBe('under, reported until WP-027');
    expect(status(bench, ran(300, 'passed', false))).toBe('over, reported until WP-027');
  });

  it('reads an enforced bench as pass, pass (retried) or fail', () => {
    expect(status(bench, ran(200, 'passed'))).toBe('pass');
    expect(status(bench, ran(200, 'passed', true, true))).toBe('pass (retried)');
    expect(status(bench, ran(300, 'failed', true, true))).toBe('fail');
  });
});

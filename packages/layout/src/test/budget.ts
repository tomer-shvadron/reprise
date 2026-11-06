/**
 * The bench side of the roadmap's budgets table: `vitest.config.ts` parses it and provides the
 * rows, since this package cannot import `scripts/bench/budgets.ts`. The declarations below repeat
 * the fields used here; a second bench file in the package imports this helper instead of
 * declaring them again.
 */
import { expect, inject, type TestContext } from 'vitest';

interface ProvidedBudget {
  metric: string;
  value: number;
  unit: string;
  threshold: number;
  factor: number;
}

interface BudgetResult {
  metric: string;
  measured: number;
  enforced: boolean;
  until?: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    budgets: ProvidedBudget[];
    budgetsError: string;
  }
  export interface TaskMeta {
    budget?: BudgetResult;
  }
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

export function roadmapBudget(metric: string): ProvidedBudget {
  const found = inject('budgets').find((budget) => budget.metric === metric);
  if (found) return found;
  const error = inject('budgetsError');
  throw new Error(
    `No row "${metric}" in the budgets table of docs/plans/roadmap.md${error ? `: ${error}` : ''}`,
  );
}

export async function checkBudget(
  context: TestContext,
  metric: string,
  p50: number,
  { enforced, until }: { enforced: boolean; until?: string },
): Promise<void> {
  const { value, unit, threshold, factor } = roadmapBudget(metric);
  const measured = round(p50);
  const against = `${String(threshold)} ${unit} threshold (budget ${String(value)} ${unit} ×${String(factor)})`;
  await context.annotate(`${metric}: p50 ${String(measured)} ${unit}, ${against}`);
  context.task.meta.budget = {
    metric,
    measured,
    enforced,
    ...(until === undefined ? {} : { until }),
  };
  if (enforced) {
    expect(
      measured,
      `${metric}: p50 ${String(measured)} ${unit} is over its ${against}`,
    ).toBeLessThanOrEqual(threshold);
  }
}

/** A measurement the budgets table has no row for: reported, never asserted. */
export async function recordMeasurement(
  context: TestContext,
  metric: string,
  p50: number,
): Promise<void> {
  const measured = round(p50);
  await context.annotate(`${metric}: p50 ${String(measured)} ms, no budget`);
  context.task.meta.budget = { metric, measured, enforced: false };
}

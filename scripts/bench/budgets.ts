/**
 * The roadmap's budgets table, read as data: `vitest.config.ts` provides it to the bench files,
 * and the budget reporter prints it, so a budget changes with a one-line edit to the table.
 */
import { readFileSync } from 'node:fs';

/** Time budgets are multiplied by this on CI; the roadmap's note under the table says why. */
export const CI_FACTOR = 3.4;

export type BudgetUnit = 'ms' | 'MB' | 'count';

export type AssertedBy =
  | { kind: 'bench'; path: string }
  | { kind: 'unit'; path: string }
  | { kind: 'e2e'; path: string }
  | { kind: 'pending'; workPackage: string };

export interface Budget {
  metric: string;
  value: number;
  unit: BudgetUnit;
  assertedBy: AssertedBy;
}

export interface ResolvedBudget extends Budget {
  threshold: number;
  factor: number;
}

/** What a bench test stores in `task.meta.budget`; the reporter reads it. */
export interface BudgetResult {
  metric: string;
  measured: number;
  enforced: boolean;
  until?: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    budgets: ResolvedBudget[];
    budgetsError: string;
  }
  export interface TaskMeta {
    budget?: BudgetResult;
  }
}

const HEADING = '## Budgets';
const HEADER = ['Metric', 'Budget', 'Asserted by'];
const VALUE = /^(\d[\d ]*)(?: (ms|MB))?$/;
const PATH = /^`([^`]+)`/;
const WORK_PACKAGE = /^WP-\d{3}/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function rowError(metric: string, problem: string): Error {
  return new Error(`docs/plans/roadmap.md, Budgets, row "${metric}": ${problem}`);
}

function assertedBy(metric: string, cell: string): AssertedBy {
  const path = PATH.exec(cell)?.[1];
  if (path?.endsWith('.bench.ts')) return { kind: 'bench', path };
  if (path !== undefined && /\.test\.tsx?$/.test(path)) return { kind: 'unit', path };
  if (path?.endsWith('.spec.ts')) return { kind: 'e2e', path };
  const workPackage = WORK_PACKAGE.exec(cell)?.[0];
  if (workPackage !== undefined) return { kind: 'pending', workPackage };
  throw rowError(
    metric,
    `"${cell}" is neither a .bench.ts, .test.ts or .spec.ts path nor a WP-0NN`,
  );
}

export function parseBudgets(markdown: string): Budget[] {
  const lines = markdown.split('\n');
  const heading = lines.findIndex((line) => line.trim() === HEADING);
  if (heading === -1) throw new Error(`docs/plans/roadmap.md: no "${HEADING}" heading`);
  const start = lines.findIndex((line, index) => index > heading && line.startsWith('|'));
  const header = start === -1 ? undefined : lines[start];
  if (header === undefined || cells(header).join('|') !== HEADER.join('|')) {
    throw new Error(
      `docs/plans/roadmap.md, Budgets: expected a table headed | ${HEADER.join(' | ')} |`,
    );
  }
  const budgets: Budget[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const [metric = '', budget = '', by = ''] = cells(line);
    const match = VALUE.exec(budget);
    if (!match) throw rowError(metric, `"${budget}" is not a number with an optional ms or MB`);
    const unit = match[2] === 'ms' || match[2] === 'MB' ? match[2] : 'count';
    const value = Number((match[1] ?? '').replaceAll(' ', ''));
    if (!(value > 0)) throw rowError(metric, `"${budget}" is not positive`);
    budgets.push({ metric, value, unit, assertedBy: assertedBy(metric, by) });
  }
  if (budgets.length === 0) throw new Error('docs/plans/roadmap.md, Budgets: the table is empty');
  return budgets;
}

export function isCi(env: Readonly<Record<string, string | undefined>>): boolean {
  const ci = env['CI'];
  return ci !== undefined && ci !== '' && ci !== '0' && ci !== 'false';
}

export function resolveBudgets(budgets: readonly Budget[], ci: boolean): ResolvedBudget[] {
  return budgets.map((budget) => {
    const factor = budget.unit === 'ms' && ci ? CI_FACTOR : 1;
    return { ...budget, factor, threshold: budget.value * factor };
  });
}

/** Never throws: a broken table fails the budgets test and the benches, not every Vitest run. */
export function loadBudgets(
  roadmapPath: string,
  env: Readonly<Record<string, string | undefined>>,
): { budgets: ResolvedBudget[]; error: string } {
  try {
    return {
      budgets: resolveBudgets(parseBudgets(readFileSync(roadmapPath, 'utf8')), isCi(env)),
      error: '',
    };
  } catch (error) {
    return { budgets: [], error: error instanceof Error ? error.message : String(error) };
  }
}

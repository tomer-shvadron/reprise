/**
 * Prints every row of the roadmap's budgets table after `pnpm bench`, with the bench results the
 * tests stored in `task.meta.budget`, and appends it to the GitHub step summary on CI. It never
 * changes the exit code: failing is the bench tests' job.
 */
import { appendFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';

import type { Reporter, TestModule, Vitest } from 'vitest/node';

import { isCi, loadBudgets, type BudgetResult, type ResolvedBudget } from './budgets.ts';

interface Outcome {
  result: BudgetResult;
  state: string;
  retried: boolean;
}

type Row = [metric: string, budget: string, threshold: string, p50: string, status: string];

const HEADER: Row = ['Metric', 'Budget', 'Threshold', 'p50', 'Status'];

const amount = (value: number, unit: string): string =>
  unit === 'count'
    ? value.toLocaleString('en-US').replaceAll(',', ' ')
    : `${String(value)} ${unit}`;

function status(budget: ResolvedBudget, outcome: Outcome | undefined): string {
  const by = budget.assertedBy;
  if (by.kind === 'unit') return `unit: ${by.path}`;
  if (by.kind === 'pending') return `pending: ${by.workPackage}`;
  if (!outcome) return 'not run';
  const { result, state, retried } = outcome;
  if (!result.enforced) {
    const side = result.measured <= budget.threshold ? 'under' : 'over';
    return `${side}, reported until ${result.until ?? 'it is enforced'}`;
  }
  if (state !== 'passed') return 'fail';
  return retried ? 'pass (retried)' : 'pass';
}

function row(budget: ResolvedBudget, outcome: Outcome | undefined): Row {
  const measured = budget.assertedBy.kind === 'bench';
  return [
    budget.metric,
    amount(budget.value, budget.unit),
    measured ? amount(budget.threshold, budget.unit) : '-',
    outcome ? amount(outcome.result.measured, budget.unit) : '-',
    status(budget, outcome),
  ];
}

function text(rows: readonly Row[]): string {
  const widths = HEADER.map((_, column) =>
    Math.max(...rows.map((cells) => cells[column]?.length ?? 0)),
  );
  return rows
    .map((cells) =>
      cells
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function markdown(rows: readonly Row[]): string {
  const [header = HEADER, ...body] = rows;
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...body.map(line)].join('\n');
}

export default class BudgetReporter implements Reporter {
  private root = process.cwd();

  onInit(vitest: Vitest): void {
    this.root = vitest.config.root;
  }

  onTestRunEnd(testModules: readonly TestModule[]): void {
    const outcomes = new Map<string, Outcome>();
    for (const module of testModules) {
      for (const test of module.children.allTests()) {
        const result = test.meta().budget;
        if (!result) continue;
        outcomes.set(result.metric, {
          result,
          state: test.result().state,
          retried: (test.diagnostic()?.retryCount ?? 0) > 0,
        });
      }
    }

    const { budgets, error } = loadBudgets(join(this.root, 'docs/plans/roadmap.md'), process.env);
    const ci = isCi(process.env);
    const cpu = cpus();
    const factor = budgets.find(({ unit }) => unit === 'ms')?.factor ?? 1;
    const title =
      `Budgets (docs/plans/roadmap.md) on ${cpu[0]?.model.trim() ?? 'unknown CPU'} ×${String(cpu.length)}, ` +
      `Node ${process.version}, ${ci ? 'CI' : 'local'}: time budgets ×${String(factor)}`;

    const rows: Row[] = [HEADER];
    for (const budget of budgets) rows.push(row(budget, outcomes.get(budget.metric)));
    const known = new Set(budgets.map(({ metric }) => metric));
    const extra = [...outcomes.values()]
      .filter(({ result }) => !known.has(result.metric))
      .map(({ result }) => `${result.metric}, p50 ${String(result.measured)} ms`);

    const lines = [
      title,
      ...(error ? [`The budgets table did not parse: ${error}`] : [text(rows)]),
      ...extra.map((measurement) => `Measured without a budget: ${measurement}`),
    ];
    process.stdout.write(`\n${lines.join('\n')}\n`);

    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary) {
      const body = [
        `### ${title}`,
        '',
        error ? `The budgets table did not parse: ${error}` : markdown(rows),
        '',
        ...extra.map((measurement) => `Measured without a budget: ${measurement}`),
        '',
      ];
      appendFileSync(summary, body.join('\n'));
    }
  }
}

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CI_FACTOR, isCi, loadBudgets, parseBudgets, resolveBudgets } from './budgets.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const ROADMAP = join(ROOT, 'docs/plans/roadmap.md');

const table = (rows: string[]): string =>
  ['## Budgets', '', '| Metric | Budget | Asserted by |', '| --- | --- | --- |', ...rows, ''].join(
    '\n',
  );

describe('the roadmap budgets table', () => {
  const { budgets, error } = loadBudgets(ROADMAP, {});

  it('parses, with a positive value on every row', () => {
    expect(error).toBe('');
    expect(budgets.length).toBeGreaterThan(0);
    for (const budget of budgets) expect(budget.value).toBeGreaterThan(0);
  });

  it('names files that exist, and each bench or e2e file names its metric verbatim', () => {
    for (const { metric, assertedBy } of budgets) {
      if (assertedBy.kind === 'pending') continue;
      const path = join(ROOT, assertedBy.path);
      expect(existsSync(path), `${metric}: ${assertedBy.path} does not exist`).toBe(true);
      if (assertedBy.kind === 'bench' || assertedBy.kind === 'e2e') {
        expect(readFileSync(path, 'utf8'), `${assertedBy.path} never names "${metric}"`).toContain(
          `'${metric}'`,
        );
      }
    }
  });

  it('states the CI factor in its note', () => {
    expect(readFileSync(ROADMAP, 'utf8')).toContain(`multiplied by ${String(CI_FACTOR)} on CI`);
  });
});

describe('parseBudgets', () => {
  it('reads units, thousands separators and the four kinds of asserter', () => {
    expect(
      parseBudgets(
        table([
          '| Cold | 250 ms | `a/b.bench.ts` |',
          '| Elements | 20 000 | `a/c.test.tsx`, once #91 merges |',
          '| Heap | 400 MB | WP-055, Playwright |',
          '| Paint | 500 ms | `a/d.spec.ts` |',
        ]),
      ),
    ).toEqual([
      {
        metric: 'Cold',
        value: 250,
        unit: 'ms',
        assertedBy: { kind: 'bench', path: 'a/b.bench.ts' },
      },
      {
        metric: 'Elements',
        value: 20_000,
        unit: 'count',
        assertedBy: { kind: 'unit', path: 'a/c.test.tsx' },
      },
      {
        metric: 'Heap',
        value: 400,
        unit: 'MB',
        assertedBy: { kind: 'pending', workPackage: 'WP-055' },
      },
      {
        metric: 'Paint',
        value: 500,
        unit: 'ms',
        assertedBy: { kind: 'e2e', path: 'a/d.spec.ts' },
      },
    ]);
  });

  it('names the row that is malformed', () => {
    expect(() => parseBudgets(table(['| Cold | fast | WP-027 |']))).toThrow(
      'docs/plans/roadmap.md, Budgets, row "Cold": "fast" is not a number',
    );
    expect(() => parseBudgets(table(['| Cold | 250 ms | soon |']))).toThrow('row "Cold"');
  });

  it('fails without the heading or the table', () => {
    expect(() => parseBudgets('# Roadmap\n')).toThrow('no "## Budgets" heading');
    expect(() => parseBudgets('## Budgets\n\n| Metric | Budget |\n')).toThrow('expected a table');
  });

  it('is reported by loadBudgets instead of thrown', () => {
    expect(loadBudgets(join(ROOT, 'missing.md'), {})).toMatchObject({ budgets: [] });
    expect(loadBudgets(join(ROOT, 'missing.md'), {}).error).not.toBe('');
  });
});

describe('resolveBudgets', () => {
  const budgets = parseBudgets(
    table([
      '| Cold | 250 ms | WP-027 |',
      '| Audio | 80 MB | WP-094 |',
      '| Elements | 20 000 | WP-024 |',
    ]),
  );

  it('scales time budgets by the CI factor on CI only', () => {
    expect(resolveBudgets(budgets, false).map(({ threshold }) => threshold)).toEqual([
      250, 80, 20_000,
    ]);
    expect(
      resolveBudgets(budgets, true).map(({ threshold, factor }) => [threshold, factor]),
    ).toEqual([
      [250 * CI_FACTOR, CI_FACTOR],
      [80, 1],
      [20_000, 1],
    ]);
  });
});

describe('isCi', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['', false],
    ['0', false],
    ['false', false],
    [undefined, false],
  ])('reads CI=%s as %s', (value, expected) => {
    expect(isCi({ CI: value })).toBe(expected);
  });
});

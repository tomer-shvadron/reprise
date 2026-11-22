import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CI_FACTOR, isCi, loadBudgets, parseBudgets, resolveBudgets } from './budgets.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const ROADMAP = join(ROOT, 'docs/plans/roadmap.md');
const AUDIO_BUDGET_SOURCE = join(ROOT, 'packages/audio/src/samples/managed-sample-source.ts');

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

  const row = (metric: string) => {
    const found = budgets.find((budget) => budget.metric === metric);
    expect(found, `docs/plans/roadmap.md has no budget row "${metric}"`).toBeDefined();
    return found;
  };

  // The constants are read as text, not imported: the audio root export pulls in DOM types the
  // scripts tsconfig lacks, a deep subpath import is banned by the boundary lint, and adding the
  // DOM lib to the scripts project would widen it for one assertion (#293). The table's "MB" is
  // MiB, because the constants multiply by MEGABYTE = 1024 * 1024.
  it.each([
    ['Decoded audio resident, GM tier, any song', 'GM_BUDGET_BYTES'],
    ['Decoded audio resident, HQ tier, default', 'HQ_BUDGET_BYTES'],
  ])('keeps the "%s" row equal to %s', (metric, constant) => {
    const source = readFileSync(AUDIO_BUDGET_SOURCE, 'utf8');
    expect(source, 'MEGABYTE is no longer 1024 * 1024').toMatch(
      /export const MEGABYTE = 1024 \* 1024;/,
    );
    const match = new RegExp(`export const ${constant} = (\\d+) \\* MEGABYTE;`).exec(source);
    expect(match, `${constant} is no longer "<n> * MEGABYTE"`).not.toBeNull();
    const found = row(metric);
    expect(found?.unit).toBe('MB');
    expect(
      found?.value,
      `the "${metric}" row and ${constant} disagree: fix the one that is wrong, and the other with it`,
    ).toBe(Number(match?.[1]));
  });

  it('keeps the mounted-elements unit test on the roadmap figure', () => {
    const source = readFileSync(join(ROOT, 'apps/web/src/features/score/budget.test.ts'), 'utf8');
    const match = /const BUDGET = ([\d_]+);/.exec(source);
    expect(match, 'budget.test.ts no longer declares "const BUDGET = <n>;"').not.toBeNull();
    expect(
      row('Mounted SVG elements at any zoom')?.value,
      'the roadmap row and BUDGET in budget.test.ts disagree: fix the one that is wrong',
    ).toBe(Number((match?.[1] ?? '').replaceAll('_', '')));
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

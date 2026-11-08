import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ResolvedBudget } from './budgets.ts';
import {
  MIN_DELTA_SHARE,
  TOLERANCE,
  comparedRows,
  markdownSummary,
  median,
  readReport,
  testNamePattern,
  textTable,
  touchesWatched,
  verdict,
  watchedPaths,
  type Verdict,
} from './compare.ts';

const ROADMAP = join(import.meta.dirname, '..', '..', 'docs/plans/roadmap.md');

const COLD = { metric: 'Full layout, cold', threshold: 850 };
const RELAYOUT = { metric: 'Re-layout', threshold: 54.4 };
const five = (value: number | undefined): (number | undefined)[] =>
  Array.from({ length: 5 }, () => value);

describe('testNamePattern', () => {
  const pattern = new RegExp(testNamePattern(['Full layout, cold', 'Odd (name.+)']));

  it('matches the metric and a describe-prefixed form, not a longer name', () => {
    expect(pattern.test('Full layout, cold')).toBe(true);
    expect(pattern.test('Some suite Full layout, cold')).toBe(true);
    expect(pattern.test('Full layout, cold, tab notation')).toBe(false);
  });

  it('escapes regex characters', () => {
    expect(pattern.test('Odd (name.+)')).toBe(true);
    expect(pattern.test('Odd (nameX+)')).toBe(false);
  });
});

describe('readReport', () => {
  const entry = (status: string, meta: unknown): unknown => ({ status, meta });

  it('reads passed and failed tests with a budget and ignores the rest', () => {
    const report = {
      testResults: [
        {
          assertionResults: [
            entry('passed', { budget: { metric: 'A', measured: 12.5, enforced: true } }),
            entry('failed', { budget: { metric: 'B', measured: 900, enforced: true } }),
            entry('skipped', {}),
          ],
        },
      ],
    };
    expect([...readReport(report)]).toEqual([
      ['A', 12.5],
      ['B', 900],
    ]);
  });

  it('gives an empty map for a malformed report', () => {
    expect(readReport(null).size).toBe(0);
    expect(readReport({}).size).toBe(0);
    expect(readReport({ testResults: [null, { assertionResults: 3 }] }).size).toBe(0);
  });
});

describe('median', () => {
  it('takes the middle, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('verdict', () => {
  it('passes identical values', () => {
    expect(verdict(COLD, five(200), five(200), false).status).toBe('pass');
  });

  it('fails a 2x slowdown in every round', () => {
    const v = verdict(COLD, five(200), five(400), false);
    expect([v.status, v.ratio, v.delta]).toEqual(['slower', 2, 200]);
  });

  it('passes a 1.3x ratio whose delta is under the minimum', () => {
    expect(verdict(RELAYOUT, five(4), five(5.2), false).status).toBe('pass');
  });

  it('passes a delta over the minimum at ratio 1.1', () => {
    expect(verdict(COLD, five(500), five(550), false).status).toBe('pass');
  });

  it('reports 0.7x as faster', () => {
    expect(verdict(COLD, five(200), five(140), false).status).toBe('faster');
  });

  it('turns slower into accepted with the label', () => {
    expect(verdict(COLD, five(200), five(400), true).status).toBe('slower, accepted');
  });

  it('reports a row base never measured as new', () => {
    expect(verdict(COLD, five(undefined), five(200), false).status).toBe('new');
  });

  it('fails a row head measured in fewer than 3 rounds', () => {
    const head = [200, undefined, 200, undefined, undefined];
    expect(verdict(COLD, five(200), head, false).status).toBe('not measured');
  });

  it('ignores a single outlier round', () => {
    const head = [600, 200, 200, 200, 200];
    expect(verdict(COLD, five(200), head, false).status).toBe('pass');
  });
});

describe('the tables', () => {
  const pass = verdict(COLD, [200, 210, 190], [202, 208, 192], false);
  const slower = verdict(RELAYOUT, [10, 10, 10], [20, 20, 20], false);
  const title = 'Bench against main: 3 rounds';

  it('prints text', () => {
    expect(textTable([pass, slower], title)).toBe(
      [
        title,
        'Metric             main      PR        Ratio  Delta     Fails above         Status',
        'Full layout, cold  200.0 ms  202.0 ms  1.01×  +2.0 ms   ×1.20 and +42.5 ms  pass',
        'Re-layout          10.0 ms   20.0 ms   2.00×  +10.0 ms  ×1.20 and +2.7 ms   slower',
      ].join('\n'),
    );
  });

  it('prints markdown with the rounds and a line per failure', () => {
    const rows: Verdict[] = [pass, slower];
    expect(markdownSummary(rows, 3, title)).toBe(
      [
        `### ${title}`,
        '',
        '| Metric | main | PR | Ratio | Delta | Fails above | Status |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| Full layout, cold | 200.0 ms | 202.0 ms | 1.01× | +2.0 ms | ×1.20 and +42.5 ms | pass |',
        '| Re-layout | 10.0 ms | 20.0 ms | 2.00× | +10.0 ms | ×1.20 and +2.7 ms | slower |',
        '',
        '<details>',
        '<summary>Every round</summary>',
        '',
        '| Metric | Round | main | PR |',
        '| --- | --- | --- | --- |',
        '| Full layout, cold | 1/3 | 200.0 ms | 202.0 ms |',
        '| Full layout, cold | 2/3 | 210.0 ms | 208.0 ms |',
        '| Full layout, cold | 3/3 | 190.0 ms | 192.0 ms |',
        '| Re-layout | 1/3 | 10.0 ms | 20.0 ms |',
        '| Re-layout | 2/3 | 10.0 ms | 20.0 ms |',
        '| Re-layout | 3/3 | 10.0 ms | 20.0 ms |',
        '',
        '</details>',
        '',
        'Re-layout is 2.00× main (+10.0 ms), over ×1.20 and +2.7 ms. A deliberate trade takes the bench:accept-slower label and a re-run of this job (docs/plans/roadmap.md#budgets).',
        '',
      ].join('\n'),
    );
  });
});

describe('watched paths', () => {
  const bench = (metric: string, path: string, unit: 'ms' | 'MB' = 'ms'): ResolvedBudget => ({
    metric,
    value: 1,
    unit,
    assertedBy: { kind: 'bench', path },
    threshold: 1,
    factor: 1,
  });
  const rows = comparedRows([bench('Cold', 'packages/layout/src/layout.bench.ts')]);
  const workspaces = new Map([
    ['packages/layout', ['packages/model']],
    ['packages/model', []],
    ['apps/web', ['packages/layout']],
  ]);
  const watched = watchedPaths(rows, workspaces);

  it('holds the bench workspace, its dependencies and the fixed list', () => {
    expect(watched).toEqual([
      'packages/layout/',
      'packages/model/',
      'scripts/bench/',
      'vitest.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.nvmrc',
      'tsconfig.base.json',
      '.github/workflows/ci.yml',
    ]);
  });

  it('keeps only ms bench rows', () => {
    expect(comparedRows([bench('Heap', 'a/b.bench.ts', 'MB')])).toEqual([]);
  });

  it('matches prefixes and exact paths', () => {
    expect(touchesWatched(['packages/model/src/x.ts'], watched)).toBe(true);
    expect(touchesWatched(['apps/web/src/x.tsx'], watched)).toBe(false);
    expect(touchesWatched(['docs/plans/roadmap.md'], watched)).toBe(false);
    expect(touchesWatched(['pnpm-lock.yaml'], watched)).toBe(true);
    expect(touchesWatched(['package.json.bak'], watched)).toBe(false);
  });
});

describe('the roadmap note', () => {
  it('states the tolerance, the delta share and the label', () => {
    const note = readFileSync(ROADMAP, 'utf8');
    expect(note).toContain(`×${TOLERANCE.toFixed(2)}`);
    expect(note).toContain(`${String(MIN_DELTA_SHARE * 100)}%`);
    expect(note).toContain('bench:accept-slower');
  });
});

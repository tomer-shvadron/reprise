import { describe, expect, it } from 'vitest';

import { baselinePath, otherFailures, runRefusal, type Run } from './accept.ts';

const BASELINE =
  'apps/web/e2e/visual/__screenshots__/score.visual.test.tsx/rhythm-values-tab-dark-chromium-linux.png';

describe('baselinePath', () => {
  it('maps an actual image to its baseline', () => {
    expect(
      baselinePath(
        'e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-actual-chromium-linux.png',
      ),
    ).toBe(BASELINE);
  });

  it('maps the reference written for a missing baseline', () => {
    expect(
      baselinePath(
        'e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-reference-chromium-linux.png',
      ),
    ).toBe(BASELINE);
  });

  it('strips a leading attachments directory', () => {
    expect(
      baselinePath(
        'apps/web/.vitest/attachments/e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-actual-chromium-linux.png',
      ),
    ).toBe(BASELINE);
  });

  it('rejects diffs, other platforms and hashed attachments', () => {
    for (const path of [
      'e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-diff-chromium-linux.png',
      'e2e/visual/score.visual.test.tsx/rhythm-values-tab-dark-actual-chromium-darwin.png',
      '86715f4e4cdc487c938a92f74d4e93210438df6c.png',
    ]) {
      expect(baselinePath(path)).toBeUndefined();
    }
  });
});

const HEAD = 'a'.repeat(40);

function run(visual: string, overrides: Partial<Run> = {}): Run {
  return {
    databaseId: 1,
    status: 'completed',
    headSha: HEAD,
    jobs: [
      {
        steps: [
          { name: 'Test', conclusion: 'success' },
          { name: 'Visual', conclusion: visual },
        ],
      },
    ],
    ...overrides,
  };
}

describe('runRefusal', () => {
  it('accepts a finished run of HEAD whose Visual step failed', () => {
    expect(runRefusal(run('failure'), HEAD)).toBeUndefined();
  });

  it('refuses a run whose Visual step passed or was skipped, whatever the run concluded', () => {
    expect(runRefusal(run('success'), HEAD)).toMatch(/Visual step is success/);
    expect(runRefusal(run('skipped'), HEAD)).toMatch(/Visual step is skipped/);
    expect(runRefusal(run('failure', { jobs: [] }), HEAD)).toMatch(/Visual step is missing/);
  });

  it('refuses a run of another commit, or one still running', () => {
    expect(runRefusal(run('failure', { headSha: 'b'.repeat(40) }), HEAD)).toMatch(
      /of bbbbbbb, not HEAD aaaaaaa/,
    );
    expect(runRefusal(run('failure', { status: 'in_progress' }), HEAD)).toMatch(/in_progress/);
  });
});

describe('otherFailures', () => {
  const report = (failureMessages: string[], message = '') => ({
    testResults: [
      {
        name: 'score.visual.test.tsx',
        message,
        assertionResults: [
          { fullName: 'a passing scene', status: 'passed', failureMessages: [] },
          { fullName: 'a failing scene', status: 'failed', failureMessages },
        ],
      },
    ],
  });

  it('passes image differences and missing references', () => {
    expect(
      otherFailures(
        report([
          'Error: \u001b[2mexpect(\u001b[22melement).toMatchScreenshot()\n\nScreenshot does not match the stored reference.\n2480 pixels differ.',
        ]),
      ),
    ).toEqual([]);
    expect(otherFailures(report(['Error: x\n\nNo existing reference screenshot found.']))).toEqual(
      [],
    );
  });

  it('lists a guard, a page-count or a font failure, and an error in the file', () => {
    expect(
      otherFailures(report(['AssertionError: the scene must break into at least two systems'])),
    ).toEqual(['a failing scene: AssertionError: the scene must break into at least two systems']);
    expect(otherFailures(report([], 'Error: font Bravura failed'))).toEqual([
      'score.visual.test.tsx: Error: font Bravura failed',
      'a failing scene: ',
    ]);
    expect(otherFailures({})).toEqual(['the report is not a Vitest JSON report']);
  });
});

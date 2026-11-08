import { describe, expect, it } from 'vitest';

import {
  SKIPS_ENV,
  SOUNDFONT_FATAL,
  SOUNDFONT_NOTE,
  isCi,
  preflight,
  projectsToRun,
  skipsFromEnv,
} from './preflight.ts';
import { classify, passed, renderSummary } from './report.ts';
import type { CheckFile, CheckRecord } from './meta.ts';

const file: CheckFile = {
  file: 'fixtures/a.gp5',
  source: 'fixtures',
  absolute: '/r/a.gp5',
  index: 0,
};
const env = { commit: 'abc1234', os: 'darwin 25.0.0' };

const record = (check: 'read' | 'audio', extra: Partial<CheckRecord> = {}): CheckRecord => ({
  file: file.file,
  check,
  summary: 'ok',
  violations: [],
  explained: [],
  facts: {},
  sections: [],
  ...extra,
});

describe('the soundfont preflight', () => {
  it('skips audio locally when the soundfont is missing', () => {
    expect(preflight(['read', 'audio'], { soundfont: false, ci: false })).toEqual({
      skips: { audio: SOUNDFONT_NOTE },
    });
  });

  it('runs audio when the soundfont is present or audio is not selected', () => {
    expect(preflight(['audio'], { soundfont: true, ci: false })).toEqual({ skips: {} });
    expect(preflight(['read', 'layout'], { soundfont: false, ci: false })).toEqual({ skips: {} });
  });

  it('stops a CI run with one line when the soundfont is missing', () => {
    expect(preflight(['audio'], { soundfont: false, ci: true })).toEqual({
      skips: {},
      fatal: SOUNDFONT_FATAL,
    });
  });

  it('reads CI from any non-empty value', () => {
    expect(isCi({ CI: 'true' })).toBe(true);
    expect(isCi({ CI: '0' })).toBe(true);
    expect(isCi({ CI: '' })).toBe(false);
    expect(isCi({})).toBe(false);
  });

  it('leaves a skipped project out of the Vitest run', () => {
    const skips = { audio: SOUNDFONT_NOTE };
    expect(projectsToRun(['formats', 'layout', 'audio'], skips)).toEqual(['formats', 'layout']);
    expect(projectsToRun(['audio'], skips)).toEqual([]);
    expect(projectsToRun(['audio'], {})).toEqual(['audio']);
  });

  it('round-trips through the environment', () => {
    const { skips } = preflight(['audio'], { soundfont: false, ci: false });
    expect(skipsFromEnv({ [SKIPS_ENV]: JSON.stringify(skips) })).toEqual(skips);
    expect(skipsFromEnv({})).toEqual({});
  });
});

describe('a skipped audio column', () => {
  const missing = record('audio', {
    violations: [{ code: 'soundfont-missing', message: 'missing' }],
  });
  const local = classify([file], ['read', 'audio'], [record('read'), missing], new Map(), [], {
    audio: SOUNDFONT_NOTE,
  });

  it('is skipped, not failed, with one note and no draft', () => {
    expect(local.files[0]?.checks.audio?.status).toBe('skipped');
    expect(local.drafts).toEqual([]);
    expect(local.summary).toMatchObject({ failed: 0, crashed: 0, notes: [SOUNDFONT_NOTE] });
    expect(passed(local.summary)).toBe(true);
    const text = renderSummary(local, env);
    expect(text).toContain(`Environment: ${SOUNDFONT_NOTE}.`);
    expect(text.match(/Environment:/g)).toHaveLength(1);
    expect(text).toContain('| fixtures/a.gp5 | pass | skipped | skipped |');
  });

  it('still fails a mixed run: skipped audio plus a real read failure', () => {
    const bad = record('read', { violations: [{ code: 'bad-read', message: 'bad' }] });
    const mixed = classify([file], ['read', 'audio'], [bad, missing], new Map(), [], {
      audio: SOUNDFONT_NOTE,
    });
    expect(passed(mixed.summary)).toBe(false);
    expect(mixed.drafts.map((draft) => draft.code)).toEqual(['bad-read']);
  });
});

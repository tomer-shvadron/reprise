import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { KNOWN_ISSUES } from './known.ts';
import type { CheckFile, CheckId, CheckRecord, CheckViolation } from './meta.ts';
import {
  classify,
  labelsFor,
  renderDraft,
  renderSummary,
  scrub,
  worst,
  writeReports,
} from './report.ts';

const env = { commit: 'abc1234', os: 'darwin 25.0.0' };

const fixture = (file: string, index = 0): CheckFile => ({
  file,
  source: 'fixtures',
  absolute: `/repo/${file}`,
  index,
});

const local = (file: string, index: number): CheckFile => ({
  file,
  source: 'local',
  absolute: `/repo/${file}`,
  index,
});

function record(file: string, check: CheckId, extra: Partial<CheckRecord> = {}): CheckRecord {
  return {
    file,
    check,
    summary: 'ok',
    violations: [],
    explained: [],
    facts: {},
    sections: [],
    ...extra,
  };
}

const violation = (code: string, data: CheckViolation['data'] = {}): CheckViolation => ({
  code,
  message: `${code} happened`,
  where: 'bar 3',
  data,
});

describe('statuses', () => {
  it('rank fail over known over skipped over explained over pass', () => {
    expect(worst(['pass', 'explained', 'skipped'])).toBe('skipped');
    expect(worst(['pass', 'known', 'skipped'])).toBe('known');
    expect(worst(['known', 'fail'])).toBe('fail');
    expect(worst([])).toBe('pass');
  });

  it('classify each check of each file', () => {
    const file = fixture('fixtures/a.gp5');
    const run = classify(
      [file],
      ['read', 'oracle', 'order', 'tempo', 'audio'],
      [
        record(file.file, 'read'),
        record(file.file, 'oracle', {
          explained: [{ id: 'grace-duration', message: '', count: 2 }],
        }),
        record(file.file, 'order', { skipped: 'no' }),
        record(file.file, 'tempo', { violations: [violation('tempo-differs')] }),
        record(file.file, 'audio', { violations: [violation('beyond-bar-end')] }),
      ],
    );
    const checks = run.files[0]?.checks;
    expect(checks?.read?.status).toBe('pass');
    expect(checks?.oracle?.status).toBe('explained');
    expect(checks?.order?.status).toBe('skipped');
    expect(checks?.tempo?.status).toBe('fail');
    expect(checks?.audio?.status).toBe('known');
    expect(checks?.audio?.known[0]?.entry.issue).toBe(118);
    expect(run.files[0]?.status).toBe('fail');
    expect(run.summary).toMatchObject({ failed: 1, known: 1, crashed: 0 });
  });

  it('turn a missing record and a crashed test into check-crashed', () => {
    const file = fixture('fixtures/a.gp5');
    const run = classify(
      [file],
      ['read', 'layout'],
      [],
      new Map([[`${file.file}|layout`, 'boom']]),
    );
    expect(run.files[0]?.checks.read?.unknown[0]?.code).toBe('check-crashed');
    expect(run.files[0]?.checks.layout?.unknown[0]?.message).toBe('boom');
    expect(run.summary.crashed).toBe(2);
  });
});

describe('the known list', () => {
  const [overfull] = KNOWN_ISSUES.filter((entry) => entry.id === 'overfull-voice-playback');
  const target = overfull?.fixtures[0] ?? '';

  it('is stale when a covered fixture no longer fires it', () => {
    const run = classify([fixture(target)], ['audio'], [record(target, 'audio')]);
    expect(run.summary.stale).toEqual(['overfull-voice-playback']);
  });

  it('is not stale where it fires, or where its check did not run', () => {
    const fired = classify(
      [fixture(target)],
      ['audio'],
      [record(target, 'audio', { violations: [violation('beyond-bar-end')] })],
    );
    expect(fired.summary.stale).toEqual([]);
    const notRun = classify([fixture(target)], ['read'], [record(target, 'read')]);
    expect(notRun.summary.stale).toEqual([]);
  });

  it('has unique ids and an issue number for each entry', () => {
    expect(new Set(KNOWN_ISSUES.map((entry) => entry.id)).size).toBe(KNOWN_ISSUES.length);
    for (const entry of KNOWN_ISSUES) expect(entry.issue).toBeGreaterThan(0);
  });
});

describe('drafts', () => {
  it('group one code across files and number them', () => {
    const files = [fixture('fixtures/a.gp5', 0), fixture('fixtures/b.gp5', 1)];
    const run = classify(
      files,
      ['layout'],
      files.map((file) =>
        record(file.file, 'layout', {
          violations: [
            violation('overlapping-marks'),
            violation('overlapping-anchors', { group: 'note' }),
          ],
        }),
      ),
    );
    expect(
      run.drafts.map((draft) => [draft.number, draft.code, draft.files, draft.occurrences.length]),
    ).toEqual([
      [1, 'overlapping-marks', 2, 2],
      [2, 'overlapping-anchors', 2, 2],
    ]);
    const second = run.drafts[1];
    if (!second) throw new Error('no second draft');
    const text = renderDraft(second, env);
    expect(text).toMatch(/^title: fix\(layout\): overlapping note anchors$/m);
    expect(text).toContain('labels: type:bug, lane:score, area:layout, phase:2');
    expect(text).toContain('`pnpm check:files fixtures/a.gp5`');
    expect(text).toContain('- **Build**: `pnpm check:files` at commit abc1234');
  });

  it('never name a local tab, its title or its tracks', () => {
    const file = local('local-tabs/Secret Song.gp5', 0);
    const run = classify(
      [file],
      ['read', 'oracle'],
      [
        record(file.file, 'read', {
          facts: {
            format: 'gp5',
            version: 510,
            tracks: 2,
            bars: 40,
            title: 'Secret Song',
            trackNames: 'Lead Riff, Bass Line',
          },
          features: [{ key: 'bends', bars: [3] }],
        }),
        record(file.file, 'oracle', {
          violations: [violation('oracle-difference', { group: 'vibrato' })],
        }),
      ],
      new Map(),
    );
    const draft = run.drafts[0];
    if (!draft) throw new Error('no draft');
    const text = renderDraft(draft, env);
    for (const secret of ['Secret Song', 'Lead Riff', 'Bass Line', 'local-tabs'])
      expect(text).not.toContain(secret);
    expect(text).toContain('local tab 1 (gp5 v510, 2 tracks, 40 bars; bends)');
  });

  it('scrub a local path out of a crash message', () => {
    const file = local('local-tabs/Secret Song.gp5', 0);
    expect(scrub(`failed on /repo/local-tabs/Secret Song.gp5 at line 2`, file)).toBe(
      'failed on <local tab> at line 2',
    );
  });
});

describe('labels', () => {
  it.each([
    ['read', 'read-failed', 'formats', 'formats'],
    ['oracle', 'oracle-difference', 'formats', 'formats'],
    ['order', 'order-differs', 'lead', 'model'],
    ['tempo', 'tempo-differs', 'lead', 'model'],
    ['layout', 'outside-page', 'score', 'layout'],
    ['audio', 'attack-missed', 'audio', 'audio'],
    ['audio', 'note-not-scheduled', 'lead', 'audio'],
    ['audio', 'beyond-bar-end', 'lead', 'audio'],
  ] as const)('%s %s goes to lane %s, area %s', (check, code, lane, area) => {
    expect(labelsFor(check, code)).toEqual({ lane, area });
  });
});

describe('writeReports', () => {
  let out: string | undefined;
  afterEach(() => {
    if (out) rmSync(out, { recursive: true, force: true });
  });

  it('writes reports, a summary and drafts, and keeps a marked listening sheet', () => {
    out = mkdtempSync(join(tmpdir(), 'check-files-out-'));
    const file = fixture('fixtures/gp5/a.gp5');
    const run = classify(
      [file],
      ['read', 'layout'],
      [
        record(file.file, 'read', { features: [{ key: 'bends', bars: [2] }] }),
        record(file.file, 'layout', { violations: [violation('overlapping-marks')] }),
      ],
    );
    writeReports(run, env, out, '/repo');
    expect(existsSync(join(out, 'fixtures/gp5/a.gp5.json'))).toBe(true);
    expect(readFileSync(join(out, 'fixtures/gp5/a.gp5.md'), 'utf8')).toContain('| layout | fail |');
    expect(readdirSync(join(out, 'drafts'))).toEqual(['01-layout-overlapping-marks.md']);
    expect(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'))).toMatchObject({
      failed: 1,
      stale: [],
    });
    const sheet = join(out, 'listening/fixtures/gp5/a.gp5.md');
    expect(readFileSync(sheet, 'utf8')).toContain('| [Bends]');
    writeFileSync(sheet, 'marked');
    writeReports(run, env, out, '/repo');
    expect(readFileSync(sheet, 'utf8')).toBe('marked');
  });

  it('puts a file outside the repository under external/', () => {
    out = mkdtempSync(join(tmpdir(), 'check-files-out-'));
    const file: CheckFile = {
      file: '/elsewhere/tab.gp5',
      source: 'local',
      absolute: '/elsewhere/tab.gp5',
      index: 0,
    };
    writeReports(classify([file], ['read'], [record(file.file, 'read')]), env, out, '/repo');
    expect(existsSync(join(out, 'external/tab.gp5.md'))).toBe(true);
  });
});

describe('the summary', () => {
  it('tables every file by check, with totals', () => {
    const file = fixture('fixtures/a.gp5');
    const run = classify(
      [file],
      ['read', 'audio'],
      [record(file.file, 'read'), record(file.file, 'audio')],
    );
    const text = renderSummary(run, env);
    expect(text).toContain('| File | read | audio | Overall |');
    expect(text).toContain('| fixtures/a.gp5 | pass | pass | pass |');
    expect(text).toContain('Totals: 0 failed, 0 known, 0 crashed, 0 stale known entries.');
  });
});

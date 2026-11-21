import { describe, expect, it } from 'vitest';

import {
  accuracyOf,
  parseKeyName,
  parseTrueKeys,
  renderKeyReport,
  trueKeyOf,
} from './test/key-report';
import type { KeyReportRow } from './test/key-report';

describe('parseKeyName', () => {
  it.each([
    ['A minor', 9, 'minor'],
    ['Am', 9, 'minor'],
    ['F# major', 6, 'major'],
    ['Bb', 10, 'major'],
    ['Bbm', 10, 'minor'],
    ['C♯ minor', 1, 'minor'],
    ['E♭', 3, 'major'],
    ['g', 7, 'major'],
  ])('%s', (text, tonic, quality) => {
    expect(parseKeyName(text)).toEqual({ tonic, quality });
  });

  it('rejects text that is no key', () => {
    expect(parseKeyName('H minor')).toBeUndefined();
    expect(parseKeyName('A dorian')).toBeUndefined();
    expect(parseKeyName('')).toBeUndefined();
  });
});

describe('parseTrueKeys and trueKeyOf', () => {
  const { keys, invalid } = parseTrueKeys({
    abc123def: 'D minor',
    'local-2': 'G',
    'fixtures/x.gp': 'C major',
    'bad-entry': 'nonsense',
    'also-bad': 5,
  });

  it('keeps the valid entries and names the invalid by label', () => {
    expect(keys.size).toBe(3);
    expect(invalid).toEqual(['bad-entry', 'also-bad']);
  });

  it('finds a key by hash prefix, local label or fixture path', () => {
    expect(trueKeyOf(keys, { file: 'local-1', hash: 'abc123def456' })).toEqual({
      tonic: 2,
      quality: 'minor',
    });
    expect(trueKeyOf(keys, { file: 'local-2', hash: '000000000000' })).toEqual({
      tonic: 7,
      quality: 'major',
    });
    expect(trueKeyOf(keys, { file: 'fixtures/x.gp' })).toEqual({ tonic: 0, quality: 'major' });
    expect(trueKeyOf(keys, { file: 'local-3', hash: 'ffffffffffff' })).toBeUndefined();
  });

  it('flags a file that is not an object', () => {
    expect(parseTrueKeys([]).invalid).toHaveLength(1);
  });
});

describe('the report', () => {
  const rows: KeyReportRow[] = [
    {
      label: 'local-1 (sha256 aaa)',
      detected: 'A minor',
      tonic: 9,
      quality: 'minor',
      confidence: 'high',
      correlation: 0.91,
      runnerUp: 'C major',
      expected: { tonic: 9, quality: 'minor' },
      expectedName: 'A minor',
    },
    {
      label: 'local-2 (sha256 bbb)',
      detected: 'G major',
      tonic: 7,
      quality: 'major',
      confidence: 'low',
      correlation: 0.5,
      runnerUp: 'D major',
      expected: { tonic: 4, quality: 'minor' },
      expectedName: 'E minor',
    },
    { label: 'fixtures/y.gp', detected: 'not enough notes' },
  ];

  it('scores exact and relative-key answers', () => {
    expect(accuracyOf(rows)).toEqual({ count: 2, exact: 1, mirex: (1 + 0.3) / 2 });
  });

  it('has no figure without listed keys', () => {
    expect(accuracyOf(rows.slice(2))).toBeUndefined();
  });

  it('renders the table, the figure and the invalid entries', () => {
    const text = renderKeyReport(rows, ['oops'], true);
    expect(text).toContain('| local-1 (sha256 aaa) | A minor | high | 0.91 | C major |');
    expect(text).toContain('Accuracy on 2 listed keys: 1 exact (50%), MIREX score 0.65.');
    expect(text).toContain('`oops`');
  });

  it('says why there is no figure', () => {
    expect(renderKeyReport(rows.slice(2), [], false)).toContain('No `local-tabs/keys.json` found');
    expect(renderKeyReport(rows.slice(2), [], true)).toContain('no accuracy figure');
  });
});

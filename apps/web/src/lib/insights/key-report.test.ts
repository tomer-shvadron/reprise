import { describe, expect, it } from 'vitest';

import {
  KEYS_PARSE_PROBLEM,
  KEYS_SHAPE_PROBLEM,
  accuracyOf,
  parseKeyName,
  parseTrueKeys,
  parseTrueKeysText,
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
    ['A Minor', 9, 'minor'],
    ['D MAJOR', 2, 'major'],
    ['AM', 9, 'major'],
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
  const { keys, invalid, ignored } = parseTrueKeys({
    abc123def: 'D minor',
    'fixtures/x.gp': 'C major',
    'fixtures/z.gp': 'nonsense',
    'local-2': 'G',
    'ZQ9SENTINEL Song.gp5': 'A minor',
  });

  it('keeps valid entries, names only recognised labels and counts the rest', () => {
    expect(keys.size).toBe(2);
    expect(invalid).toEqual(['fixtures/z.gp']);
    expect(ignored).toBe(2);
  });

  it('finds a key by hash prefix, full hash or fixture path', () => {
    expect(trueKeyOf(keys, { file: 'local-1', hash: 'abc123def456' })).toEqual({
      tonic: 2,
      quality: 'minor',
    });
    expect(trueKeyOf(keys, { file: 'fixtures/x.gp' })).toEqual({ tonic: 0, quality: 'major' });
    expect(trueKeyOf(keys, { file: 'local-2', hash: '000000000000' })).toBeUndefined();
    const full = parseTrueKeys({ ['abc123def456' + '0'.repeat(52)]: 'E' }).keys;
    expect(trueKeyOf(full, { file: 'local-1', hash: 'abc123def456' })).toEqual({
      tonic: 4,
      quality: 'major',
    });
  });

  it('flags a file that is not an object', () => {
    expect(parseTrueKeys([]).problem).toBe(KEYS_SHAPE_PROBLEM);
  });

  it('reports bad JSON with a fixed message that quotes nothing', () => {
    const parsed = parseTrueKeysText('{ "ZQ9SENTINEL Song.gp5": A minor }');
    expect(parsed.problem).toBe(KEYS_PARSE_PROBLEM);
    const text = renderKeyReport([], parsed, true);
    expect(text).toContain('could not be parsed');
    expect(text).not.toContain('ZQ9SENTINEL');
  });

  it('never prints an unrecognised label', () => {
    const listed = parseTrueKeys({
      'ZQ9SENTINEL Song.gp5': 'A minor',
      'ZQ9SENTINEL Two.gp5': 'nope',
    });
    const text = renderKeyReport([], listed, true);
    expect(text).toContain('2 entries');
    expect(text).not.toContain('ZQ9SENTINEL');
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
    const text = renderKeyReport(rows, parseTrueKeys({ 'fixtures/oops.gp': 'x' }), true);
    expect(text).toContain('| local-1 (sha256 aaa) | A minor | high | 0.91 | C major |');
    expect(text).toContain('Accuracy on 2 listed keys: 1 exact (50%), MIREX score 0.65.');
    expect(text).toContain('`fixtures/oops.gp`');
  });

  it('says why there is no figure', () => {
    expect(renderKeyReport(rows.slice(2), undefined, false)).toContain(
      'No `local-tabs/keys.json` found',
    );
    expect(renderKeyReport(rows.slice(2), undefined, true)).toContain('no accuracy figure');
  });
});

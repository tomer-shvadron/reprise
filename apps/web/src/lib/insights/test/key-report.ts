import type { Confidence } from '../key';
import type { Detected } from './mirex';
import { isExact, mirexScore } from './mirex';

/** The `local-tabs/keys.json` file: the owner's true keys, never committed. */
export const KEYS_FILE = 'local-tabs/keys.json';

const LETTERS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * `A minor`, `F# major`, `Bb`, `Am`, `C♯m`: a tonic and a mode, major when none is written; the
 * words are any case, while `m` is minor and `M` major. Anything else is `undefined`, so a typo is
 * reported instead of scored as a miss.
 */
export function parseKeyName(
  text: string,
): { tonic: number; quality: 'major' | 'minor' } | undefined {
  const match = /^\s*([A-Ga-g])\s*([#♯b♭]?)\s*(m|M|min|minor|maj|major)?\s*$/i.exec(text);
  const letter = match?.[1];
  if (!match || letter === undefined) return undefined;
  const base = LETTERS[letter.toUpperCase()];
  if (base === undefined) return undefined;
  const accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] === '' ? 0 : -1;
  const mode = match[3] ?? '';
  // `m` alone is minor and `M` alone major, so only the one-letter forms are case-sensitive.
  const minor = mode === 'm' || /^min/i.test(mode);
  return { tonic: (((base + accidental) % 12) + 12) % 12, quality: minor ? 'minor' : 'major' };
}

type ListedKey = { tonic: number; quality: 'major' | 'minor' };

export interface TrueKeys {
  keys: Map<string, ListedKey>;
  /** Labels in a recognised form (a hash prefix or a fixture path) whose key names no key. */
  invalid: string[];
  /** Entries ignored without being named: the owner's text could be a file name. */
  ignored: number;
  /** The file could not be used at all; the message is fixed and quotes nothing from it. */
  problem?: string;
}

export const HASH_LABEL = /^[0-9a-f]{6,64}$/i;
const isFixtureLabel = (label: string): boolean => /^fixtures\/[\w./-]+$/.test(label);

export const KEYS_PARSE_PROBLEM = `${KEYS_FILE} could not be parsed`;
export const KEYS_SHAPE_PROBLEM = `${KEYS_FILE} is not an object of labels to key names`;

/** `{ "<sha256 prefix or fixture path>": "A minor" }`. */
export function parseTrueKeys(json: unknown): TrueKeys {
  const result: TrueKeys = { keys: new Map(), invalid: [], ignored: 0 };
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    result.problem = KEYS_SHAPE_PROBLEM;
    return result;
  }
  for (const [label, value] of Object.entries(json)) {
    if (!HASH_LABEL.test(label) && !isFixtureLabel(label)) {
      result.ignored++;
      continue;
    }
    const key = typeof value === 'string' ? parseKeyName(value) : undefined;
    if (key) result.keys.set(HASH_LABEL.test(label) ? label.toLowerCase() : label, key);
    else result.invalid.push(label);
  }
  return result;
}

/** The text of the file; a syntax error is reported by a fixed message, never by the parser's. */
export function parseTrueKeysText(text: string): TrueKeys {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { keys: new Map(), invalid: [], ignored: 0, problem: KEYS_PARSE_PROBLEM };
  }
  return parseTrueKeys(parsed);
}

/** The listed key of a file, by fixture path or by a hash prefix (or the full hash) of its bytes. */
export function trueKeyOf(
  keys: TrueKeys['keys'],
  file: { file: string; hash?: string },
): ListedKey | undefined {
  const hash = file.hash;
  if (hash === undefined) return keys.get(file.file);
  for (const [label, key] of keys) {
    if (HASH_LABEL.test(label) && (hash.startsWith(label) || label.startsWith(hash))) return key;
  }
  return undefined;
}

export interface KeyReportRow {
  /** A fixture's path, or `local-N (sha256 …)`. */
  label: string;
  /** `not enough notes`, or the detected key. */
  detected: string;
  tonic?: number;
  quality?: 'major' | 'minor' | 'none';
  confidence?: Confidence;
  correlation?: number;
  runnerUp?: string;
  scale?: string;
  /** The file's own signature names the detected key or its relative. */
  agreesWithFile?: boolean;
  expected?: { tonic: number; quality: 'major' | 'minor' };
  /** The listed key, as written in the report. */
  expectedName?: string;
}

export interface Accuracy {
  count: number;
  exact: number;
  /** The mean MIREX key score, 0 to 1. */
  mirex: number;
}

export function accuracyOf(rows: readonly KeyReportRow[]): Accuracy | undefined {
  const listed = rows.filter((row) => row.expected !== undefined);
  if (listed.length === 0) return undefined;
  let exact = 0;
  let mirex = 0;
  for (const row of listed) {
    const { expected } = row;
    if (!expected) continue;
    const detected: Detected | undefined =
      row.tonic !== undefined && row.quality !== undefined
        ? { tonic: row.tonic, quality: row.quality }
        : undefined;
    mirex += mirexScore(expected, detected);
    if (isExact(expected, detected)) exact++;
  }
  return { count: listed.length, exact, mirex: mirex / listed.length };
}

const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

export function renderKeyReport(
  rows: readonly KeyReportRow[],
  listed: TrueKeys = { keys: new Map(), invalid: [], ignored: 0 },
  keysFileFound = false,
): string {
  const lines = [
    '# Key detection',
    '',
    'The detected key per file, from `apps/web/src/lib/insights`. A local tab is named by its `local-N` label and hash only.',
    '',
    '| File | Key | Confidence | Correlation | Runner-up | Scale | File signature | Listed key | Score |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const expected = row.expected;
    const detected: Detected | undefined =
      row.tonic !== undefined && row.quality !== undefined
        ? { tonic: row.tonic, quality: row.quality }
        : undefined;
    const score = expected ? String(mirexScore(expected, detected)) : '';
    const agrees =
      row.agreesWithFile === undefined ? '' : row.agreesWithFile ? 'agrees' : 'differs';
    lines.push(
      `| ${row.label} | ${row.detected} | ${row.confidence ?? ''} | ${row.correlation === undefined ? '' : row.correlation.toFixed(2)} | ${row.runnerUp ?? ''} | ${row.scale ?? ''} | ${agrees} | ${row.expectedName ?? ''} | ${score} |`,
    );
  }
  lines.push('');
  const accuracy = accuracyOf(rows);
  if (accuracy) {
    lines.push(
      `Accuracy on ${String(accuracy.count)} listed key${accuracy.count === 1 ? '' : 's'}: ${String(accuracy.exact)} exact (${percent(accuracy.exact / accuracy.count)}), MIREX score ${accuracy.mirex.toFixed(2)}.`,
    );
  } else {
    lines.push(
      keysFileFound
        ? `No file in this run has a key listed in \`${KEYS_FILE}\`, so there is no accuracy figure.`
        : `No \`${KEYS_FILE}\` found, so there is no accuracy figure (see the player checklist for its format).`,
    );
  }
  if (listed.problem !== undefined) lines.push('', `${listed.problem}.`);
  if (listed.invalid.length > 0) {
    lines.push(
      '',
      `Entries in \`${KEYS_FILE}\` that name no key: ${listed.invalid.map((label) => `\`${label}\``).join(', ')}.`,
    );
  }
  if (listed.ignored > 0) {
    lines.push(
      '',
      `${String(listed.ignored)} entr${listed.ignored === 1 ? 'y' : 'ies'} in \`${KEYS_FILE}\` ignored: a label must be a hash prefix of 6 or more digits or a fixture path.`,
    );
  }
  const matched = rows.filter((row) => row.expected !== undefined).length;
  if (listed.keys.size > matched) {
    lines.push(
      '',
      `${String(listed.keys.size - matched)} listed key${listed.keys.size - matched === 1 ? '' : 's'} matched no file in this run.`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

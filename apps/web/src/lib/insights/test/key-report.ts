import type { Confidence } from '../key';
import type { Detected } from './mirex';
import { isExact, mirexScore } from './mirex';

/** The `local-tabs/keys.json` file: the owner's true keys, never committed. */
export const KEYS_FILE = 'local-tabs/keys.json';

const LETTERS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * `A minor`, `F# major`, `Bb`, `Am`, `C♯m`: a tonic and a mode, major when none is written.
 * Anything else is `undefined`, so a typo is reported instead of scored as a miss.
 */
export function parseKeyName(
  text: string,
): { tonic: number; quality: 'major' | 'minor' } | undefined {
  const match = /^\s*([A-Ga-g])\s*([#♯b♭]?)\s*(m|min|minor|M|maj|major)?\s*$/.exec(text);
  const letter = match?.[1];
  if (!match || letter === undefined) return undefined;
  const base = LETTERS[letter.toUpperCase()];
  if (base === undefined) return undefined;
  const accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] === '' ? 0 : -1;
  const mode = match[3] ?? '';
  // A bare lowercase letter or "m" is minor; "b" after a letter is a flat, so "Bb" is B flat.
  const minor = mode === 'm' || mode === 'min' || mode === 'minor';
  return { tonic: (((base + accidental) % 12) + 12) % 12, quality: minor ? 'minor' : 'major' };
}

export interface TrueKeys {
  keys: Map<string, { tonic: number; quality: 'major' | 'minor' }>;
  /** The entries that name no key, by their own label: never a file name. */
  invalid: string[];
}

/** `{ "<sha256 prefix, local-N or fixture path>": "A minor" }`. */
export function parseTrueKeys(json: unknown): TrueKeys {
  const result: TrueKeys = { keys: new Map(), invalid: [] };
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    result.invalid.push('the file is not an object of labels to key names');
    return result;
  }
  for (const [label, value] of Object.entries(json)) {
    const key = typeof value === 'string' ? parseKeyName(value) : undefined;
    if (key) result.keys.set(label, key);
    else result.invalid.push(label);
  }
  return result;
}

/** A listed key for a file by its fixture path, `local-N` or a hash prefix of at least 6 digits. */
export function trueKeyOf(
  keys: TrueKeys['keys'],
  file: { file: string; hash?: string },
): { tonic: number; quality: 'major' | 'minor' } | undefined {
  const direct = keys.get(file.file);
  if (direct) return direct;
  const hash = file.hash;
  if (hash === undefined) return undefined;
  for (const [label, key] of keys) {
    if (/^[0-9a-f]{6,}$/i.test(label) && hash.startsWith(label.toLowerCase())) return key;
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
  invalid: readonly string[] = [],
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
  if (invalid.length > 0) {
    lines.push(
      '',
      `Entries in \`${KEYS_FILE}\` that name no key: ${invalid.map((label) => `\`${label}\``).join(', ')}.`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

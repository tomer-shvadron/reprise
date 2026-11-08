/**
 * The pure logic of `pnpm bench:compare`: which budgeted rows to bench, how a run's JSON report
 * reads, the verdict on a row across rounds, and the tables. Nothing here spawns a process, so
 * Node runs it before `pnpm install`.
 */
import { CI_FACTOR, type ResolvedBudget } from './budgets.ts';

/** A row fails above this paired median ratio, and only with a delta over the minimum below. */
export const TOLERANCE = 1.2;
/** The smallest delta that fails a row, as a share of its threshold, so a sub-ms wobble never does. */
export const MIN_DELTA_SHARE = 0.05;
/** Per-metric overrides of `MIN_DELTA_SHARE`. */
export const FLOOR_SHARES: Readonly<Record<string, number>> = {
  // 0.5 ms on CI: max(0.5 ms, 1.5 × the largest unchanged delta, 0.1 ms over ten runs), #146.
  'Re-layout after a rhythm edit, continuous': 0.5 / (16 * CI_FACTOR),
};

export function floorShare(
  metric: string,
  overrides: Readonly<Record<string, number>> = FLOOR_SHARES,
): number {
  return overrides[metric] ?? MIN_DELTA_SHARE;
}
export const ROUNDS = 5;
/** Fewer paired rounds than this and a row counts as not measured. */
export const MIN_PAIRED_ROUNDS = 3;

export type Status = 'pass' | 'faster' | 'slower' | 'slower, accepted' | 'new' | 'not measured';

export interface Verdict {
  metric: string;
  minDelta: number;
  /** Medians over the rounds that measured the row, per tree. */
  base: number | undefined;
  head: number | undefined;
  /** Medians of the paired rounds. */
  ratio: number | undefined;
  delta: number | undefined;
  status: Status;
  rounds: { base: number | undefined; head: number | undefined }[];
}

export type Row = Pick<ResolvedBudget, 'metric' | 'threshold'> & { floorShare?: number };

export function comparedRows(budgets: readonly ResolvedBudget[]): ResolvedBudget[] {
  return budgets.filter(({ unit, assertedBy }) => unit === 'ms' && assertedBy.kind === 'bench');
}

export function benchFiles(rows: readonly ResolvedBudget[]): string[] {
  const paths = rows.flatMap(({ assertedBy }) =>
    assertedBy.kind === 'bench' ? [assertedBy.path] : [],
  );
  return [...new Set(paths)];
}

/** Anchored at the end only, so a `describe` prefix matches and "X, tab notation" does not match "X". */
export function testNamePattern(metrics: readonly string[]): string {
  const escaped = metrics.map((metric) =>
    metric.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
  );
  return `(?:${escaped.join('|')})$`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads `meta.budget` from vitest's JSON report; never throws, a malformed report is empty. */
export function readReport(json: unknown): Map<string, number> {
  const measured = new Map<string, number>();
  if (!isRecord(json) || !Array.isArray(json['testResults'])) return measured;
  for (const file of json['testResults']) {
    if (!isRecord(file) || !Array.isArray(file['assertionResults'])) continue;
    for (const test of file['assertionResults']) {
      const meta = isRecord(test) ? test['meta'] : undefined;
      const budget = isRecord(meta) ? meta['budget'] : undefined;
      if (!isRecord(budget)) continue;
      const { metric, measured: value } = budget;
      if (typeof metric === 'string' && typeof value === 'number') measured.set(metric, value);
    }
  }
  return measured;
}

/** Reads the optional `meta.budget.note` of each row, the context a bare number lacks. */
export function readNotes(json: unknown): Map<string, string> {
  const notes = new Map<string, string>();
  if (!isRecord(json) || !Array.isArray(json['testResults'])) return notes;
  for (const file of json['testResults']) {
    if (!isRecord(file) || !Array.isArray(file['assertionResults'])) continue;
    for (const test of file['assertionResults']) {
      const meta = isRecord(test) ? test['meta'] : undefined;
      const budget = isRecord(meta) ? meta['budget'] : undefined;
      if (!isRecord(budget)) continue;
      const { metric, note } = budget;
      if (typeof metric === 'string' && typeof note === 'string') notes.set(metric, note);
    }
  }
  return notes;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle] ?? Number.NaN;
  return sorted.length % 2 === 1 ? high : ((sorted[middle - 1] ?? Number.NaN) + high) / 2;
}

function defined(values: readonly (number | undefined)[]): number[] {
  return values.filter((value): value is number => value !== undefined);
}

function medianOrUndefined(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : median(values);
}

export function verdict(
  row: Row,
  base: readonly (number | undefined)[],
  head: readonly (number | undefined)[],
  accepted: boolean,
  baseReported = true,
): Verdict {
  const minDelta = row.threshold * (row.floorShare ?? MIN_DELTA_SHARE);
  const rounds = head.map((value, index) => ({ base: base[index], head: value }));
  const paired = rounds.flatMap(({ base: b, head: h }) =>
    b !== undefined && h !== undefined ? [{ ratio: h / b, delta: h - b }] : [],
  );
  const result: Verdict = {
    metric: row.metric,
    minDelta,
    base: medianOrUndefined(defined(base)),
    head: medianOrUndefined(defined(head)),
    ratio: medianOrUndefined(paired.map(({ ratio }) => ratio)),
    delta: medianOrUndefined(paired.map(({ delta }) => delta)),
    rounds,
    status: 'not measured',
  };
  // `new` means base reported other rows but not this one; an empty base is a broken base.
  if (!baseReported) return result;
  if (defined(base).length === 0 && defined(head).length > 0) return { ...result, status: 'new' };
  if (
    paired.length < MIN_PAIRED_ROUNDS ||
    result.ratio === undefined ||
    result.delta === undefined
  ) {
    return result;
  }
  if (result.ratio > TOLERANCE && result.delta > minDelta) {
    return { ...result, status: accepted ? 'slower, accepted' : 'slower' };
  }
  return { ...result, status: result.ratio < 1 / TOLERANCE ? 'faster' : 'pass' };
}

const HEADER = ['Metric', 'main', 'PR', 'Ratio', 'Delta', 'Fails above', 'Status'];

const ms = (value: number | undefined): string =>
  value === undefined ? '-' : `${value.toFixed(1)} ms`;
const signed = (value: number | undefined): string =>
  value === undefined ? '-' : `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(1)} ms`;
const times = (value: number | undefined): string =>
  value === undefined ? '-' : `${value.toFixed(2)}×`;

function cells(v: Verdict): string[] {
  return [
    v.metric,
    ms(v.base),
    ms(v.head),
    times(v.ratio),
    signed(v.delta),
    `×${TOLERANCE.toFixed(2)} and +${v.minDelta.toFixed(1)} ms`,
    v.status,
  ];
}

export function textTable(verdicts: readonly Verdict[], title: string): string {
  const rows = [HEADER, ...verdicts.map(cells)];
  const widths = HEADER.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  const lines = rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd(),
  );
  return [title, ...lines].join('\n');
}

export function noteLines(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
): string[] {
  return [...new Set([...base.keys(), ...head.keys()])].map(
    (metric) => `${metric}: main ${base.get(metric) ?? '-'}; PR ${head.get(metric) ?? '-'}.`,
  );
}

export function failureLines(verdicts: readonly Verdict[]): string[] {
  return verdicts.flatMap((v) => {
    if (v.status === 'not measured') {
      return [`${v.metric} was not measured in enough rounds on both trees, so it cannot pass.`];
    }
    if (v.status !== 'slower' || v.ratio === undefined || v.delta === undefined) return [];
    return [
      `${v.metric} is ${times(v.ratio)} main (${signed(v.delta)}), over ×${TOLERANCE.toFixed(2)} and +${v.minDelta.toFixed(1)} ms. ` +
        'A deliberate trade takes the bench:accept-slower label and a re-run of this job (docs/plans/roadmap.md#budgets).',
    ];
  });
}

export const NO_BASE_REPORT =
  'main produced no bench report in any round; check the base install and that main still has the bench files.';

export function acceptedLines(verdicts: readonly Verdict[]): string[] {
  return verdicts.flatMap((v) =>
    v.status === 'slower, accepted' && v.ratio !== undefined && v.delta !== undefined
      ? [
          `${v.metric} is ${times(v.ratio)} main (${signed(v.delta)}), accepted by the bench:accept-slower label. ` +
            'The label stays until removed, so it accepts every later push too.',
        ]
      : [],
  );
}

export function markdownSummary(
  verdicts: readonly Verdict[],
  rounds: number,
  title: string,
): string {
  const line = (row: readonly string[]): string => `| ${row.join(' | ')} |`;
  const table = [
    line(HEADER),
    line(HEADER.map(() => '---')),
    ...verdicts.map((v) => line(cells(v))),
  ];
  const detail = [
    line(['Metric', 'Round', 'main', 'PR']),
    line(['---', '---', '---', '---']),
    ...verdicts.flatMap((v) =>
      v.rounds.map((round, index) =>
        line([v.metric, `${String(index + 1)}/${String(rounds)}`, ms(round.base), ms(round.head)]),
      ),
    ),
  ];
  const failures = [...failureLines(verdicts), ...acceptedLines(verdicts)];
  return [
    `### ${title}`,
    '',
    ...table,
    '',
    '<details>',
    '<summary>Every round</summary>',
    '',
    ...detail,
    '',
    '</details>',
    '',
    ...failures.flatMap((failure) => [failure, '']),
  ].join('\n');
}

/** Workspace directory to the directories of the workspace packages it depends on. */
export type Workspaces = ReadonlyMap<string, readonly string[]>;

export const FIXED_WATCHED = [
  'scripts/bench/',
  'vitest.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.nvmrc',
  'tsconfig.base.json',
  '.github/workflows/ci.yml',
];

/** Entries ending in `/` are prefixes, the rest exact paths. */
export function watchedPaths(rows: readonly ResolvedBudget[], workspaces: Workspaces): string[] {
  const seen = new Set<string>();
  const visit = (dir: string): void => {
    if (seen.has(dir)) return;
    seen.add(dir);
    for (const dependency of workspaces.get(dir) ?? []) visit(dependency);
  };
  for (const { assertedBy } of rows) {
    if (assertedBy.kind === 'bench') visit(assertedBy.path.split('/').slice(0, 2).join('/'));
  }
  return [...[...seen].map((dir) => `${dir}/`), ...FIXED_WATCHED];
}

export function touchesWatched(changed: readonly string[], watched: readonly string[]): boolean {
  return changed.some((path) =>
    watched.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry)),
  );
}

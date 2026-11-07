/**
 * Judges the records the checks emit and writes the reports: statuses against the known list,
 * stale known entries, per-file Markdown and JSON, the summary, listening sheets and draft
 * issues. Drafts never name a local tab, its title or its tracks (the repo is public).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { KNOWN_ISSUES, knownFor } from './known.ts';
import type { KnownIssue } from './known.ts';
import { CHECKLIST, listeningSheet } from './listening.ts';
import type { CheckFile, CheckId, CheckRecord, CheckViolation } from './meta.ts';

export type Status = 'pass' | 'explained' | 'skipped' | 'known' | 'fail';

/** Worst first. */
const SEVERITY: readonly Status[] = ['fail', 'known', 'skipped', 'explained', 'pass'];

export interface Classified {
  record: CheckRecord;
  status: Status;
  known: { violation: CheckViolation; entry: KnownIssue }[];
  unknown: CheckViolation[];
}

export interface FileReport {
  file: CheckFile;
  checks: Partial<Record<CheckId, Classified>>;
  status: Status;
  /** `local tab 3 (gp5 v510, 4 tracks, 120 bars; repeats, bends)` for a local file; the path otherwise. */
  label: string;
}

export interface Occurrence {
  label: string;
  file: CheckFile;
  violation: CheckViolation;
}

export interface Draft {
  number: number;
  check: CheckId;
  code: string;
  group: string;
  occurrences: Occurrence[];
  files: number;
}

export interface RunSummary {
  failed: number;
  known: number;
  stale: string[];
  crashed: number;
}

export interface RunReport {
  files: FileReport[];
  checks: readonly CheckId[];
  stale: KnownIssue[];
  drafts: Draft[];
  summary: RunSummary;
}

export interface Environment {
  commit: string;
  os: string;
}

export function worst(statuses: readonly Status[]): Status {
  return SEVERITY.find((status) => statuses.includes(status)) ?? 'pass';
}

export function statusOf(record: CheckRecord, unknown: number): Status {
  if (record.skipped !== undefined) return 'skipped';
  if (unknown > 0) return 'fail';
  if (record.violations.length > 0) return 'known';
  return record.explained.length > 0 ? 'explained' : 'pass';
}

/** The record a check that crashed, or never reported, stands for. */
export function crashedRecord(file: string, check: CheckId, error: string): CheckRecord {
  return {
    file,
    check,
    summary: 'the check crashed',
    violations: [{ code: 'check-crashed', message: error }],
    explained: [],
    facts: {},
    sections: [],
  };
}

/** A local tab's error text with its path and file name taken out. */
export function scrub(text: string, file: CheckFile): string {
  if (file.source !== 'local') return text;
  const name = basename(file.absolute);
  return [file.absolute, file.file, name]
    .filter((part) => part !== '')
    .reduce((out, part) => out.split(part).join('<local tab>'), text);
}

const count = (value: unknown, noun: string): string =>
  typeof value === 'number' ? `${String(value)} ${noun}${value === 1 ? '' : 's'}` : '';

function localLabel(number: number, read: CheckRecord | undefined): string {
  if (!read || read.skipped !== undefined) return `local tab ${String(number)}`;
  const { facts } = read;
  const format =
    typeof facts['format'] === 'string' ? facts['format'] : String(facts['extension'] ?? '?');
  const version = facts['version'] === undefined ? '' : ` v${String(facts['version'])}`;
  const size = [count(facts['tracks'], 'track'), count(facts['bars'], 'bar')].filter(
    (part) => part !== '',
  );
  const features = (read.features ?? []).slice(0, 6).map((feature) => feature.key);
  const details = [`${format}${version}`, ...size].join(', ');
  return `local tab ${String(number)} (${details}${features.length > 0 ? `; ${features.join(', ')}` : ''})`;
}

export function classify(
  files: readonly CheckFile[],
  checks: readonly CheckId[],
  records: readonly CheckRecord[],
  crashes: ReadonlyMap<string, string> = new Map(),
): RunReport {
  const byKey = new Map(records.map((record) => [`${record.file}|${record.check}`, record]));
  let local = 0;
  const reports = files.map((file): FileReport => {
    const classified: Partial<Record<CheckId, Classified>> = {};
    for (const check of checks) {
      const key = `${file.file}|${check}`;
      const crash = crashes.get(key);
      const record =
        crash === undefined
          ? (byKey.get(key) ?? crashedRecord(file.file, check, 'the check reported no record'))
          : crashedRecord(file.file, check, scrub(crash, file));
      const known: Classified['known'] = [];
      const unknown: CheckViolation[] = [];
      for (const violation of record.violations) {
        const entry = knownFor(check, violation);
        if (entry) known.push({ violation, entry });
        else unknown.push(violation);
      }
      classified[check] = { record, status: statusOf(record, unknown.length), known, unknown };
    }
    const status = worst(Object.values(classified).map((entry) => entry.status));
    if (file.source === 'local') local += 1;
    const label = file.source === 'local' ? localLabel(local, classified.read?.record) : file.file;
    return { file, checks: classified, status, label };
  });

  const stale = KNOWN_ISSUES.filter((entry) =>
    entry.fixtures.some((fixture) => {
      const report = reports.find((candidate) => candidate.file.file === fixture);
      const classified = report?.checks[entry.check];
      if (!classified || classified.record.skipped !== undefined) return false;
      return !classified.known.some((hit) => hit.entry.id === entry.id);
    }),
  );

  const groups = new Map<string, Draft>();
  for (const report of reports) {
    for (const check of checks) {
      for (const violation of report.checks[check]?.unknown ?? []) {
        const group = typeof violation.data?.['group'] === 'string' ? violation.data['group'] : '';
        const key = `${check}:${violation.code}:${group}`;
        const draft = groups.get(key) ?? {
          number: 0,
          check,
          code: violation.code,
          group,
          occurrences: [],
          files: 0,
        };
        if (!draft.occurrences.some((occurrence) => occurrence.file === report.file))
          draft.files += 1;
        draft.occurrences.push({ label: report.label, file: report.file, violation });
        groups.set(key, draft);
      }
    }
  }
  const drafts = [...groups.values()].map((draft, i) => ({ ...draft, number: i + 1 }));

  const all = reports.flatMap((report) => Object.values(report.checks));
  return {
    files: reports,
    checks,
    stale,
    drafts,
    summary: {
      failed: all.filter((entry) => entry.status === 'fail').length,
      known: all.filter((entry) => entry.status === 'known').length,
      stale: stale.map((entry) => entry.id),
      crashed: all.filter((entry) =>
        entry.record.violations.some((v) => v.code === 'check-crashed'),
      ).length,
    },
  };
}

export function passed(summary: RunSummary): boolean {
  return summary.failed === 0 && summary.stale.length === 0 && summary.crashed === 0;
}

interface Labels {
  lane: string;
  area: string;
}

export function labelsFor(check: CheckId, code: string): Labels {
  switch (check) {
    case 'read':
    case 'oracle':
      return { lane: 'formats', area: 'formats' };
    case 'order':
    case 'tempo':
      return { lane: 'lead', area: 'model' };
    case 'layout':
      return { lane: 'score', area: 'layout' };
    case 'audio':
      return code === 'beyond-bar-end' || code.startsWith('note-')
        ? { lane: 'lead', area: 'audio' }
        : { lane: 'audio', area: 'audio' };
  }
}

interface CodeText {
  title: string;
  should: string;
}

const CODE_TEXT: Readonly<Record<string, CodeText>> = {
  'read-failed': {
    title: 'a file fails to read',
    should:
      'Every Guitar Pro file Guitar Pro opens reads, or fails with a FormatError that names a real defect in the file.',
  },
  'error-warning': {
    title: 'the reader loses content ({group})',
    should:
      'An `error`-severity warning means content was lost; a file Guitar Pro opens whole should read whole.',
  },
  'oracle-difference': {
    title: 'reading differs from alphaTab on {group}',
    should:
      'The reader matches alphaTab 1.8.4 except where `packages/formats/test/oracle/tolerances.ts` documents a difference.',
  },
  'master-bar-count': {
    title: 'the master-bar count differs from alphaTab',
    should: 'Ours and alphaTab 1.8.4 read the same master bars.',
  },
  'order-differs': {
    title: 'the play order differs from alphaTab',
    should:
      'The expander follows alphaTab 1.8.4\'s MIDI generator order except where the model README\'s "Deviations from alphaTab" table documents a difference; Guitar Pro decides where they disagree.',
  },
  'pass-length': {
    title: 'a pass lasts a different length than in alphaTab',
    should:
      "Each pass lasts as many ticks as alphaTab 1.8.4's, except that an anacrusis is capped at its written length and an over-full bar lasts exactly its longest voice (#121) where alphaTab keeps the written length.",
  },
  'tempo-differs': {
    title: 'the tempo map differs from alphaTab',
    should:
      "The tempo changes and durations match alphaTab 1.8.4's, except a ramp (README), a moved mid-beat change (`tempo-moved`) or the overflow of an over-full bar, which alphaTab plays over the next bars.",
  },
  'layout-threw': {
    title: 'layout throws on a real file',
    should: 'Layout lays out every score the readers produce.',
  },
  'non-finite': {
    title: 'non-finite numbers in a result',
    should:
      'Every coordinate and every sample is finite (`check-result.ts` invariant, or the audio sink contract).',
  },
  'outside-page': {
    title: 'primitives outside the A4 page',
    should:
      'Nothing crosses a page edge (`expectInsidePages` in `packages/layout/src/test/check-result.ts`).',
  },
  'outside-margins': {
    title: 'a system crosses the top or bottom margin',
    should:
      'Every system stays inside its page less the top and bottom margins (`expectInsidePages`).',
  },
  'overlapping-anchors': {
    title: 'overlapping {group} anchors',
    should: 'Anchors of one kind, system, staff and voice never overlap (`overlappingAnchors`).',
  },
  'overlapping-marks': {
    title: 'overlapping marks above or below a staff',
    should: 'Text and effect glyphs in one lane never overlap (`overlappingMarks`).',
  },
  'soundfont-missing': {
    title: 'the GM soundfont is missing',
    should: 'Run `pnpm sounds:fetch` before the pass.',
  },
  'peak-over-1': {
    title: 'the GM render clips',
    should: 'The master stays at or under full scale.',
  },
  'silent-render': {
    title: 'a song with audible notes renders silent',
    should: 'Audible notes sound.',
  },
  'sound-without-notes': {
    title: 'sound without audible notes',
    should: 'A song with no audible notes renders silence.',
  },
  'memory-over-budget': {
    title: 'decoded samples exceed the GM budget',
    should: 'Decoded samples stay within `GM_BUDGET_BYTES`.',
  },
  'sample-missed': {
    title: 'notes skipped for an undecoded sample',
    should: 'Every sample the song reaches is decoded before it plays.',
  },
  'silent-strike': {
    title: 'strikes with no sampler region',
    should: 'Every struck key finds a region in its preset.',
  },
  'zero-velocity': {
    title: 'notes struck at velocity 0',
    should: 'Every note is struck with a positive velocity.',
  },
  'note-not-scheduled': {
    title: 'notes never reach the sampler',
    should:
      'Every untied note of every pass reaches the sink once (the sink contract in `packages/audio/src/sink.ts`).',
  },
  'note-scheduled-twice': {
    title: 'notes scheduled twice',
    should: 'Every note of a pass reaches the sink exactly once.',
  },
  'note-mistimed': {
    title: 'notes scheduled off their beat',
    should: 'Every note starts at its beat on the tempo map, within 1 ms.',
  },
  'note-unexpected': {
    title: 'events that match no note',
    should: 'The sink receives only notes of the pass it plays.',
  },
  'beyond-bar-end': {
    title: 'beats past the end of an over-full bar',
    should: 'Every beat of an over-full bar plays, and the bar lasts its longest voice (#121).',
  },
  'attack-missed': {
    title: 'scheduled notes are not heard in the render',
    should: 'Every scheduled attack is audible in the render (spectral-flux ratio ≥ 1.2).',
  },
  'check-crashed': {
    title: 'a check crashes',
    should: 'Every check runs to the end and reports what it found.',
  },
};

function codeText(code: string, group: string): CodeText {
  const text = CODE_TEXT[code] ?? { title: code, should: 'See the check that reported it.' };
  return { ...text, title: text.title.replace('{group}', group === '' ? code : group) };
}

export function draftTitle(draft: Draft): string {
  return `fix(${labelsFor(draft.check, draft.code).area}): ${codeText(draft.code, draft.group).title}`;
}

const MAX_OCCURRENCES = 10;
const EVIDENCE = 5;

const occurrenceLine = ({ label, violation }: Occurrence): string =>
  `${label}: ${violation.message}${violation.where === undefined ? '' : ` (${violation.where})`}`;

export function renderDraft(draft: Draft, env: Environment): string {
  const { lane, area } = labelsFor(draft.check, draft.code);
  const text = codeText(draft.code, draft.group);
  const fixtures = [
    ...new Set(
      draft.occurrences.filter((o) => o.file.source === 'fixtures').map((o) => o.file.file),
    ),
  ];
  const locals = [
    ...new Set(draft.occurrences.filter((o) => o.file.source === 'local').map((o) => o.label)),
  ];
  const steps =
    fixtures.length > 0
      ? [
          `1. \`pnpm check:files ${fixtures[0] ?? ''}\``,
          `2. Read \`.check-files/${fixtures[0] ?? ''}.md\`, the ${draft.check} section.`,
        ]
      : [
          `1. ${locals[0] ?? 'a local tab'}: reproduce in a fixture or a hand-built score before writing the test (AGENTS.md, Testing).`,
          `2. \`pnpm check:files <that file>\` and read its report.`,
        ];
  const files = [...fixtures, ...locals].slice(0, MAX_OCCURRENCES);
  const orderNote =
    draft.check === 'order' || draft.check === 'tempo'
      ? '\n\nIf the oracle check also differs on master bars, this is the reader: relabel `lane:formats`.'
      : '';
  return [
    `title: ${draftTitle(draft)}`,
    `labels: type:bug, lane:${lane}, area:${area}, phase:2`,
    'milestone: Player',
    `search first: ${draft.code} ${area}`,
    '---',
    '## What happened',
    '',
    `The \`${draft.check}\` check of \`pnpm check:files\` reports \`${draft.code}\` ${String(draft.occurrences.length)} time${draft.occurrences.length === 1 ? '' : 's'} in ${String(draft.files)} file${draft.files === 1 ? '' : 's'}.${orderNote}`,
    '',
    '## What should have happened',
    '',
    text.should,
    '',
    '## Steps to reproduce',
    '',
    ...steps,
    '',
    `**File**: ${files.join('; ')}`,
    '',
    '## Environment',
    '',
    `- **Build**: \`pnpm check:files\` at commit ${env.commit}`,
    `- **OS**: ${env.os}`,
    `- **Sound tier**: ${draft.check === 'audio' ? 'GM (GeneralUser GS 2.0.3)' : 'not relevant'}`,
    '',
    '## Evidence',
    '',
    ...draft.occurrences.slice(0, EVIDENCE).map((occurrence) => `- ${occurrenceLine(occurrence)}`),
    '',
  ].join('\n');
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function draftFileName(draft: Draft): string {
  return `${pad(draft.number)}-${draft.check}-${draft.code}.md`;
}

/** Where a file's reports live under the output folder, without an extension. */
export function reportPath(file: CheckFile): string {
  return file.file.startsWith('/') || /^[A-Za-z]:/.test(file.file)
    ? join('external', basename(file.file))
    : file.file;
}

const cell = (text: string): string => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

export function renderSummary(run: RunReport, env: Environment): string {
  const header = ['File', ...run.checks, 'Overall'];
  const lines = [
    '# check:files summary',
    '',
    `Commit ${env.commit}; ${String(run.files.length)} file${run.files.length === 1 ? '' : 's'}.`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...run.files.map(
      (report) =>
        `| ${cell(report.file.source === 'local' ? report.label : report.file.file)} | ${run.checks.map((check) => report.checks[check]?.status ?? '-').join(' | ')} | ${report.status} |`,
    ),
    '',
    `Totals: ${String(run.summary.failed)} failed, ${String(run.summary.known)} known, ${String(run.summary.crashed)} crashed, ${String(run.summary.stale.length)} stale known entries.`,
  ];
  for (const check of run.checks) {
    const counts = new Map<Status, number>();
    for (const report of run.files) {
      const status = report.checks[check]?.status;
      if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    lines.push(
      `- ${check}: ${SEVERITY.filter((s) => counts.has(s))
        .map((s) => `${String(counts.get(s))} ${s}`)
        .join(', ')}`,
    );
  }
  if (run.stale.length > 0) {
    lines.push(
      '',
      '## Stale known entries',
      '',
      ...run.stale.map(
        (entry) =>
          `- \`${entry.id}\` (#${String(entry.issue)}) no longer fires on its fixtures; delete it from \`scripts/check-files/known.ts\`.`,
      ),
    );
  }
  if (run.drafts.length > 0) {
    lines.push(
      '',
      '## Draft issues',
      '',
      ...run.drafts.map((draft) => `- [${draftTitle(draft)}](drafts/${draftFileName(draft)})`),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderFile(report: FileReport, run: RunReport, env: Environment): string {
  const read = report.checks.read?.record.facts ?? {};
  const local = report.file.source === 'local';
  const fact = (key: string): string => (read[key] === undefined ? '?' : String(read[key]));
  const lines = [
    `# ${local ? report.label : report.file.file}`,
    '',
    ...(local
      ? [
          `- File: ${report.file.file}`,
          `- Title: ${fact('title')}`,
          `- Tracks: ${fact('trackNames')}`,
        ]
      : []),
    `- Format: ${fact('format')}${read['version'] === undefined ? '' : `, version ${fact('version')}`}`,
    `- ${fact('tracks')} tracks, ${fact('bars')} bars, ${fact('notes')} notes, ${fact('durationSeconds')} s`,
    `- Commit: ${env.commit}`,
    '',
    '| Check | Status | Summary |',
    '| --- | --- | --- |',
    ...run.checks.map((check) => {
      const entry = report.checks[check];
      return `| ${check} | ${entry?.status ?? '-'} | ${cell(entry?.record.summary ?? '')} |`;
    }),
  ];
  for (const check of run.checks) {
    const entry = report.checks[check];
    if (!entry) continue;
    for (const section of entry.record.sections)
      lines.push('', `## ${check}: ${section.title}`, '', section.markdown);
    if (entry.record.violations.length > 0 || entry.record.explained.length > 0) {
      lines.push('', `## ${check}: findings`, '');
      for (const { violation, entry: known } of entry.known) {
        lines.push(
          `- known #${String(known.issue)} \`${violation.code}\`: ${violation.message}${violation.where ? ` (${violation.where})` : ''}`,
        );
      }
      for (const violation of entry.unknown) {
        lines.push(
          `- **fail** \`${violation.code}\`: ${violation.message}${violation.where ? ` (${violation.where})` : ''}`,
        );
      }
      for (const explained of entry.record.explained) {
        lines.push(
          `- explained \`${explained.id}\` × ${String(explained.count)}: ${explained.message}`,
        );
      }
    }
  }
  const drafts = run.drafts.filter((draft) =>
    draft.occurrences.some((o) => o.file === report.file),
  );
  if (drafts.length > 0)
    lines.push('', '## Drafts', '', ...drafts.map((draft) => `- ${draftTitle(draft)}`));
  return `${lines.join('\n')}\n`;
}

/** Writes every report under `out`; listening sheets are written only when missing. */
export function writeReports(run: RunReport, env: Environment, out: string, root: string): void {
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  for (const report of run.files) {
    const base = join(out, reportPath(report.file));
    const records = Object.values(report.checks).map((entry) => entry.record);
    write(
      `${base}.json`,
      `${JSON.stringify({ file: report.file.file, status: report.status, records }, null, 2)}\n`,
    );
    write(`${base}.md`, renderFile(report, run, env));
    const sheet = join(out, 'listening', `${reportPath(report.file)}.md`);
    if (!existsSync(sheet)) {
      const link = relative(dirname(sheet), join(root, CHECKLIST)).split('\\').join('/');
      const heading =
        report.file.source === 'local' ? `${report.label}, ${report.file.file}` : report.file.file;
      write(sheet, listeningSheet(heading, report.checks.read?.record.features ?? [], link));
    }
  }
  for (const draft of run.drafts)
    write(join(out, 'drafts', draftFileName(draft)), renderDraft(draft, env));
  write(join(out, 'summary.md'), renderSummary(run, env));
  write(join(out, 'summary.json'), `${JSON.stringify(run.summary, null, 2)}\n`);
}

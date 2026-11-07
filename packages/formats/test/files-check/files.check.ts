/**
 * The node half of `pnpm check:files`: reading, alphaTab parity of reading, playback order and
 * the tempo map, one test per file and check. A test fails only when its check crashes; what it
 * finds travels in `task.meta.check` to `scripts/check-files/reporter.ts`, which judges it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expandPlaybackSequence, tempoMap } from '@reprise/model';
import type { PlaybackSequence, Score } from '@reprise/model';
import { describe, inject, it } from 'vitest';
import type * as alphaTab from '@coderline/alphatab';

import { FormatError, detect, read, readGp3To5, writeGp } from '../../src/index';
import type { ReadResult, Warning } from '../../src/index';
import { countNotes } from '../corpus';
import { compareProjections } from '../oracle/compare';
import { loadWithAlphaTab, projectAlphaTab } from '../oracle/project-alphatab';
import { projectOurs } from '../oracle/project-ours';
import { READERS } from '../oracle/readers';
import { toleranceFor } from '../oracle/tolerances';
import { emptyRecord } from './check-meta';
import type { CheckFile, CheckId, CheckRecord } from './check-meta';
import { listeningFeatures } from './read-facts';
import { shownValue } from './redact';
import {
  alphaTabPlayback,
  compareOrder,
  compareTempo,
  detectDeviations,
  runLength,
} from './playback';
import type { AlphaTabPlayback } from './playback';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const OUT = process.env['REPRISE_CHECK_OUT'] ?? join(ROOT, '.check-files');
const MAX_ORACLE_VIOLATIONS = 200;

interface Loaded {
  bytes: Uint8Array;
  result?: ReadResult;
  error?: unknown;
  alphaTab?: alphaTab.model.Score;
  alphaTabError?: string;
  playback?: AlphaTabPlayback;
  sequence?: PlaybackSequence;
  orderIdentical?: boolean;
}

const cache = new Map<string, Promise<Loaded>>();

function load(file: CheckFile): Promise<Loaded> {
  let loaded = cache.get(file.file);
  if (!loaded) {
    loaded = (async () => {
      const bytes = new Uint8Array(readFileSync(file.absolute));
      try {
        return { bytes, result: await read(bytes) };
      } catch (error) {
        return { bytes, error };
      }
    })();
    cache.set(file.file, loaded);
  }
  return loaded;
}

function withAlphaTab(loaded: Loaded): alphaTab.model.Score | undefined {
  if (loaded.alphaTab || loaded.alphaTabError !== undefined) return loaded.alphaTab;
  try {
    loaded.alphaTab = loadWithAlphaTab(loaded.bytes);
  } catch (error) {
    loaded.alphaTabError = error instanceof Error ? error.message : String(error);
  }
  return loaded.alphaTab;
}

const plural = (count: number, noun: string): string =>
  `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

/** A local file's table leaves out the messages, which may quote the file's text. */
function warningTable(warnings: readonly Warning[], local: boolean): string {
  const rows = new Map<string, { severity: string; count: number; message: string }>();
  for (const warning of warnings) {
    const key = `${warning.code}|${warning.severity}`;
    const row = rows.get(key) ?? { severity: warning.severity, count: 0, message: warning.message };
    row.count += warning.count ?? 1;
    rows.set(key, row);
  }
  if (rows.size === 0) return 'No warnings.';
  if (local) {
    return [
      '| Code | Severity | Count |',
      '| --- | --- | --- |',
      ...[...rows.entries()].map(
        ([key, row]) => `| ${key.split('|')[0] ?? ''} | ${row.severity} | ${String(row.count)} |`,
      ),
    ].join('\n');
  }
  return [
    '| Code | Severity | Count | First message |',
    '| --- | --- | --- | --- |',
    ...[...rows.entries()].map(
      ([key, row]) =>
        `| ${key.split('|')[0] ?? ''} | ${row.severity} | ${String(row.count)} | ${row.message.replaceAll('|', '\\|')} |`,
    ),
  ].join('\n');
}

function chordDiagrams(score: Score): number {
  let count = 0;
  for (const track of score.tracks) {
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) if (beat.chord?.diagram) count += 1;
      }
    }
  }
  return count;
}

function checkRead(file: CheckFile, loaded: Loaded, record: CheckRecord, ms: number): void {
  const extension = file.absolute.split('.').pop()?.toLowerCase() ?? '';
  record.facts['extension'] = extension;
  const detected = detect(loaded.bytes);
  if (detected) record.facts['format'] = detected;
  if (!loaded.result) {
    const error = loaded.error;
    const code = error instanceof FormatError ? error.code : 'unexpected';
    record.violations.push({
      code: 'read-failed',
      message: error instanceof Error ? error.message : String(error),
      data: { code },
    });
    record.summary = `does not read (${code})`;
    return;
  }
  const { score, warnings } = loaded.result;
  if (detected === 'gp3' || detected === 'gp4' || detected === 'gp5') {
    record.facts['version'] = readGp3To5(loaded.bytes).version;
  }
  const errors = new Map<string, number>();
  for (const warning of warnings) {
    if (warning.severity === 'error') {
      errors.set(warning.code, (errors.get(warning.code) ?? 0) + (warning.count ?? 1));
    }
  }
  for (const [code, count] of errors) {
    record.violations.push({
      code: 'error-warning',
      message: `the reader reported ${plural(count, code)} with severity error`,
      data: { group: code, code, count },
    });
  }
  const notes = countNotes(score);
  const sequence = expandPlaybackSequence(score);
  const durationSeconds = tempoMap(score, sequence.sequence).durationSeconds;
  let exported: ReturnType<typeof writeGp> | undefined;
  try {
    exported = writeGp(score);
    const exportPath = join(OUT, 'exports', `${file.file}.gp`);
    mkdirSync(dirname(exportPath), { recursive: true });
    writeFileSync(exportPath, exported.bytes);
  } catch (error) {
    // The file read; a failing export is its own finding and must not cost the read's facts.
    record.violations.push({
      code: 'export-failed',
      message: `the .gp export throws: ${error instanceof Error ? error.name : 'an error'}`,
    });
  }
  Object.assign(record.facts, {
    tracks: score.tracks.length,
    bars: score.masterBars.length,
    notes,
    durationSeconds: Math.round(durationSeconds * 10) / 10,
    chordDiagrams: chordDiagrams(score),
    readMs: Math.round(ms),
  });
  if (exported) {
    record.facts['writerDropped'] = new Set(exported.dropped.map((drop) => drop.code)).size;
  }
  record.features = listeningFeatures(score);
  const mismatch =
    detected !== undefined && detected !== extension ? `; the bytes are ${detected}` : '';
  record.summary = `${plural(score.tracks.length, 'track')}, ${plural(score.masterBars.length, 'bar')}, ${plural(notes, 'note')}, ${plural(warnings.length, 'warning')}${mismatch}`;
  record.sections.push({
    title: 'Read warnings',
    markdown: warningTable(warnings, file.source === 'local'),
  });
  if (exported && exported.dropped.length > 0) {
    record.sections.push({
      title: 'Not carried by the gp export',
      markdown: exported.dropped
        .map((drop) => `- \`${drop.code}\` × ${String(drop.count)}: ${drop.message}`)
        .join('\n'),
    });
  }
}

function checkOracle(file: CheckFile, loaded: Loaded, record: CheckRecord): void {
  const score = loaded.result?.score;
  if (!score) {
    record.skipped = 'the file did not read';
    return;
  }
  const at = withAlphaTab(loaded);
  if (!at) {
    record.skipped = `alphaTab cannot read this file: ${loaded.alphaTabError ?? ''}`;
    return;
  }
  const format = detect(loaded.bytes);
  const reader = READERS.find((candidate) => candidate.extension === format);
  if (!reader) {
    record.skipped = `no oracle reader for ${format ?? 'an unknown format'}`;
    return;
  }
  const ours = reader.read(loaded.bytes);
  const projections = {
    ours: projectOurs(ours),
    alphaTab: projectAlphaTab(
      at,
      ours.tracks.map((track) => track.kind),
    ),
  };
  const differences = compareProjections(file.file, projections.ours, projections.alphaTab);
  const explained = new Map<string, { message: string; count: number }>();
  let unexplained = 0;
  for (const difference of differences) {
    const tolerance = toleranceFor(difference, reader.extension, projections);
    if (tolerance) {
      const entry = explained.get(tolerance.id) ?? { message: tolerance.why, count: 0 };
      entry.count += 1;
      explained.set(tolerance.id, entry);
      continue;
    }
    unexplained += 1;
    if (record.violations.length < MAX_ORACLE_VIOLATIONS) {
      const local = file.source === 'local';
      const ours = shownValue(difference.ours, local);
      const theirs = shownValue(difference.alphaTab, local);
      record.violations.push({
        code: 'oracle-difference',
        message: `${difference.field}: ours ${ours}, alphaTab ${theirs}`,
        where: difference.path,
        data: { group: difference.field, ours, alphaTab: theirs },
      });
    }
  }
  record.explained = [...explained.entries()].map(([id, { message, count }]) => ({
    id,
    message,
    count,
  }));
  record.facts['differences'] = differences.length;
  record.facts['unexplainedTotal'] = unexplained;
  record.summary =
    unexplained === 0
      ? `matches alphaTab 1.8.4 (${plural(differences.length, 'tolerated difference')})`
      : `${plural(unexplained, 'unexplained difference')} from alphaTab 1.8.4`;
}

function checkOrder(loaded: Loaded, record: CheckRecord): void {
  const score = loaded.result?.score;
  const at = withAlphaTab(loaded);
  if (!score) {
    record.skipped = 'the file did not read';
    return;
  }
  if (!at) {
    record.skipped = `alphaTab cannot read this file: ${loaded.alphaTabError ?? ''}`;
    return;
  }
  const sequence = expandPlaybackSequence(score);
  const playback = alphaTabPlayback(at);
  loaded.sequence = sequence;
  loaded.playback = playback;
  const ours = sequence.sequence.map((pass) => pass.masterBarIndex);
  const comparison = compareOrder(ours, playback, detectDeviations(score, sequence.warnings), {
    ours: score.masterBars.length,
    alphaTab: at.masterBars.length,
  });
  loaded.orderIdentical = comparison.identical;
  record.violations = comparison.violations;
  record.explained = comparison.explained;
  record.facts['passes'] = ours.length;
  record.facts['alphaTabPasses'] = playback.passes.length;
  const lines = [
    `- Ours: ${runLength(ours)}`,
    `- alphaTab: ${runLength(playback.passes.map((pass) => pass.masterBarIndex))}`,
  ];
  if (comparison.firstDivergence !== undefined) {
    lines.push(`- First divergence: pass ${String(comparison.firstDivergence + 1)}`);
  }
  if (sequence.warnings.length > 0) {
    lines.push(
      '',
      ...sequence.warnings.map(
        (w) => `- \`${w.code}\` at bar ${String(w.masterBarIndex + 1)}: ${w.message}`,
      ),
    );
  }
  record.sections.push({ title: 'Play order (1-based bars)', markdown: lines.join('\n') });
  record.summary = comparison.identical
    ? `${plural(ours.length, 'pass')}, identical to alphaTab`
    : `${plural(ours.length, 'pass')} against alphaTab's ${String(playback.passes.length)}`;
}

function checkTempo(loaded: Loaded, record: CheckRecord): void {
  const score = loaded.result?.score;
  if (!score || !loaded.sequence || !loaded.playback) {
    record.skipped = 'the order check did not run';
    return;
  }
  if (loaded.orderIdentical !== true) {
    record.skipped = 'order differs; tempo compared only on an identical order';
    return;
  }
  const tempoMoved = loaded.result?.warnings.some((w) => w.code === 'tempo-moved') ?? false;
  const comparison = compareTempo(score, loaded.sequence.sequence, loaded.playback, tempoMoved);
  record.violations = comparison.violations;
  record.explained = comparison.explained;
  record.facts['oursSeconds'] = Math.round(comparison.oursSeconds * 1000) / 1000;
  record.facts['alphaTabSeconds'] = Math.round(comparison.alphaTabSeconds * 1000) / 1000;
  record.summary = `${comparison.oursSeconds.toFixed(2)} s, alphaTab ${comparison.alphaTabSeconds.toFixed(2)} s`;
}

const files = inject('checkFiles');
const CHECKS: readonly CheckId[] = ['read', 'oracle', 'order', 'tempo'];

describe.each(files)('$file', (file) => {
  for (const check of CHECKS) {
    it(check, async ({ task }) => {
      task.meta.checkTarget = { file: file.file, check };
      const started = performance.now();
      const loaded = await load(file);
      const record = emptyRecord(file.file, check);
      if (check === 'read') checkRead(file, loaded, record, performance.now() - started);
      else if (check === 'oracle') checkOracle(file, loaded, record);
      else if (check === 'order') checkOrder(loaded, record);
      else checkTempo(loaded, record);
      if (record.skipped !== undefined) record.summary = `skipped: ${record.skipped}`;
      task.meta.check = record;
    });
  }
});

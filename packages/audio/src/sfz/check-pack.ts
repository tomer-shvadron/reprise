/**
 * The pure half of `pnpm sfz:check`: loads every `.sfz` of a pack snapshot and verifies that each
 * sample file exists and starts with a header this loader decodes, without Web Audio. The Node
 * side reads the directory (this package is typed without Node's modules) and hands over a
 * snapshot: whole text files and the first bytes of every other file.
 */
import { sniffSampleHeader } from './decode';
import type { SampleFormat } from './decode';
import { loadSfz } from './load';
import { emptyReport, isClean } from './report';
import type { SfzReport } from './report';

export interface SnapshotFile {
  size: number;
  /** The whole file for text and small files, else its first bytes (enough for a header). */
  bytes: Uint8Array;
}

/** Pack-relative '/' paths to files. */
export type PackSnapshot = Readonly<Record<string, SnapshotFile>>;

export interface SfzFileCheck {
  path: string;
  regions: number;
  samples: number;
  formats: Partial<Record<SampleFormat, number>>;
  rates: number[];
  /** Referenced files that are not in the pack; `(case differs: x)` when only the case is off. */
  missing: string[];
  /** Referenced files whose header is not WAV, FLAC or Ogg of a usable rate. */
  badHeaders: { path: string; error: string }[];
  report: SfzReport;
  /** Why this file fails the check; empty when it passes. */
  errors: string[];
}

/** The text of a file the loader read, and a refusal for anything missing. */
function reader(snapshot: PackSnapshot) {
  return (path: string): Promise<Uint8Array> => {
    const file = snapshot[path];
    return file ? Promise.resolve(file.bytes) : Promise.reject(new Error(`No file ${path}`));
  };
}

function caseInsensitive(snapshot: PackSnapshot): Map<string, string> {
  return new Map(Object.keys(snapshot).map((path) => [path.toLowerCase(), path]));
}

export async function checkSfzFile(snapshot: PackSnapshot, path: string): Promise<SfzFileCheck> {
  const { regions, report } = await loadSfz(path, reader(snapshot), { packId: 'check' });
  const prefix = 'sfz:check/';
  const refs = [...new Set(regions.map((region) => region.sample))];
  const folded = caseInsensitive(snapshot);
  const result: SfzFileCheck = {
    path,
    regions: report.regions,
    samples: refs.length,
    formats: {},
    rates: [],
    missing: [],
    badHeaders: [],
    report,
    errors: [],
  };
  const rates = new Set<number>();
  for (const ref of refs) {
    const file = ref.slice(prefix.length);
    const found = snapshot[file];
    if (!found) {
      const other = folded.get(file.toLowerCase());
      result.missing.push(other === undefined ? file : `${file} (case differs: ${other})`);
      continue;
    }
    try {
      const header = sniffSampleHeader(found.bytes);
      result.formats[header.format] = (result.formats[header.format] ?? 0) + 1;
      rates.add(header.sampleRate);
    } catch (error) {
      result.badHeaders.push({
        path: file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  result.rates = [...rates].sort((a, b) => a - b);
  if (!isClean(report))
    result.errors.push('the load lost data (see invalid, includes, paths, limits)');
  if (result.missing.length > 0)
    result.errors.push(`${String(result.missing.length)} missing sample files`);
  if (result.badHeaders.length > 0) {
    result.errors.push(`${String(result.badHeaders.length)} sample files with an unusable header`);
  }
  if (result.regions === 0) result.errors.push('no regions');
  return result;
}

/** Every `.sfz` under the snapshot, in path order; a file `loadSfz` cannot read is an error row. */
export async function checkPack(snapshot: PackSnapshot): Promise<SfzFileCheck[]> {
  const paths = Object.keys(snapshot)
    .filter((path) => path.toLowerCase().endsWith('.sfz'))
    .sort();
  const results: SfzFileCheck[] = [];
  for (const path of paths) {
    try {
      results.push(await checkSfzFile(snapshot, path));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        path,
        regions: 0,
        samples: 0,
        formats: {},
        rates: [],
        missing: [],
        badHeaders: [],
        report: emptyReport(),
        errors: [`unreadable: ${message}`],
      });
    }
  }
  return results;
}

const names = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${name}x${String(count)}`)
    .join(' ');

/** A readable table, one block per SFZ file, for the terminal. */
export function formatPackReport(results: readonly SfzFileCheck[]): string {
  const lines: string[] = [];
  for (const r of results) {
    const formats = Object.entries(r.formats)
      .map(([format, count]) => `${format}x${String(count)}`)
      .join(' ');
    lines.push(
      `${r.errors.length === 0 ? 'ok  ' : 'FAIL'} ${r.path}`,
      `     regions ${String(r.regions)}, sample files ${String(r.samples)} (${formats || 'none'}), rates ${r.rates.join('/') || 'none'} Hz`,
      `     dropped: ${names(r.report.dropped) || 'none'}; clamped: ${names(r.report.clamped) || 'none'}; embedded loops ${String(r.report.embeddedLoop)}`,
      `     unsupported: ${names(r.report.unsupported) || 'none'}`,
      `     unknown: ${names(r.report.unknown) || 'none'}`,
    );
    if (Object.keys(r.report.invalid).length > 0)
      lines.push(`     invalid: ${names(r.report.invalid)}`);
    for (const note of r.report.notes) lines.push(`     note: ${note}`);
    for (const include of r.report.unresolvedIncludes)
      lines.push(`     unresolved include: ${include}`);
    for (const escaped of r.report.escapedPaths) lines.push(`     escaped path: ${escaped}`);
    for (const limit of r.report.limits) lines.push(`     limit: ${limit}`);
    for (const missing of r.missing.slice(0, 20)) lines.push(`     missing: ${missing}`);
    for (const bad of r.badHeaders.slice(0, 20))
      lines.push(`     bad header: ${bad.path}: ${bad.error}`);
    for (const error of r.errors) lines.push(`     error: ${error}`);
  }
  return lines.join('\n');
}

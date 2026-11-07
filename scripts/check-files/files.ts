/** Which files `pnpm check:files` covers: every Guitar Pro file under the paths it is given. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const ROOT_DIR = join(import.meta.dirname, '..', '..');

/** Where the reports go; the variable exists so a test can keep its run out of the real folder. */
export const OUT_DIR = process.env['REPRISE_CHECK_OUT'] ?? join(ROOT_DIR, '.check-files');

export const EXTENSIONS = new Set(['.gp3', '.gp4', '.gp5', '.gpx', '.gp']);

/** The default paths, relative to the repository root. */
export const DEFAULT_PATHS = ['fixtures', 'local-tabs'];

export interface DiscoveredFile {
  /** A fixture's repo-relative path; `local-<n>` for any other file, which is never named. */
  file: string;
  absolute: string;
  source: 'fixtures' | 'local';
  /** A local file's SHA-256, first 12 hex digits: how the owner tells `local-<n>` apart. */
  hash?: string;
}

export interface Discovery {
  files: DiscoveredFile[];
  /** Paths that do not exist; the CLI exits with code 2 on any. */
  missing: string[];
  /** Folders that exist but hold no Guitar Pro file. */
  empty: string[];
  skipped: number;
}

const toPosix = (path: string): string => path.split(sep).join('/');

/** The report key: repo-relative POSIX inside the repository, absolute outside it. */
export function reportKey(absolute: string, root = ROOT_DIR): string {
  const inside = relative(root, absolute);
  return inside.startsWith('..') || isAbsolute(inside) ? toPosix(absolute) : toPosix(inside);
}

function shortHash(absolute: string): string {
  return createHash('sha256').update(readFileSync(absolute)).digest('hex').slice(0, 12);
}

function walk(dir: string, out: string[], counts: { skipped: number }): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      counts.skipped += 1;
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out, counts);
    else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(path);
    else counts.skipped += 1;
  }
}

/**
 * `paths` resolve against `cwd`; with none, the defaults resolve against the root, and a
 * default folder that does not exist counts as empty rather than missing.
 */
export function discover(
  paths: readonly string[],
  cwd: string = process.env['INIT_CWD'] ?? process.cwd(),
  root = ROOT_DIR,
): Discovery {
  const defaults = paths.length === 0;
  const targets = defaults
    ? DEFAULT_PATHS.map((path) => join(root, path))
    : paths.map((path) => resolve(cwd, path));
  const found = new Set<string>();
  const missing: string[] = [];
  const empty: string[] = [];
  const counts = { skipped: 0 };
  targets.forEach((target, i) => {
    const given = defaults ? (DEFAULT_PATHS[i] ?? target) : (paths[i] ?? target);
    if (!existsSync(target)) {
      if (defaults) empty.push(given);
      else missing.push(given);
      return;
    }
    if (statSync(target).isDirectory()) {
      const inside: string[] = [];
      walk(target, inside, counts);
      if (inside.length === 0) empty.push(given);
      for (const path of inside) found.add(path);
    } else {
      found.add(target);
    }
  });
  const fixtures = join(root, 'fixtures') + sep;
  const sorted = [...found].sort((a, b) => {
    const [x, y] = [reportKey(a, root), reportKey(b, root)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
  let local = 0;
  const files = sorted.map((absolute): DiscoveredFile => {
    if (absolute.startsWith(fixtures)) {
      return { file: reportKey(absolute, root), absolute, source: 'fixtures' };
    }
    local += 1;
    return { file: `local-${String(local)}`, absolute, source: 'local', hash: shortHash(absolute) };
  });
  return { files, missing, empty, skipped: counts.skipped };
}

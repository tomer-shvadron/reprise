/**
 * `pnpm check:files [paths…] [--only formats,layout,audio]`: the real-file pass over every Guitar
 * Pro file under the paths (by default `fixtures/` and `local-tabs/`). Plain Node cannot import
 * the workspace packages, so this drives Vitest under `vitest.config.ts`; its reporter writes
 * `.check-files/` and the verdict this script turns into the exit code.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startVitest } from 'vitest/node';

import { OUT_DIR as OUT, ROOT_DIR, discover } from './files.ts';
import { SKIPS_ENV, checksFor, preflight, soundfontPresent } from './preflight.ts';
const PROJECTS = ['formats', 'layout', 'audio'];

function usage(message: string): never {
  console.error(`${message}\nUsage: pnpm check:files [paths…] [--only ${PROJECTS.join(',')}]`);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): { paths: string[]; only: string[] } {
  const paths: string[] = [];
  let only: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--only' || arg.startsWith('--only=')) {
      const value = arg === '--only' ? argv[(i += 1)] : arg.slice('--only='.length);
      if (value === undefined) usage('--only needs a value');
      only = value.split(',').filter((name) => name !== '');
      const unknown = only.filter((name) => !PROJECTS.includes(name));
      if (unknown.length > 0) usage(`unknown --only value: ${unknown.join(', ')}`);
    } else if (arg === '--') {
      continue;
    } else if (arg.startsWith('--')) {
      usage(`unknown option ${arg}`);
    } else {
      paths.push(arg);
    }
  }
  return { paths, only };
}

function commit(): string {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    }).trim();
    return dirty === '' ? head : `${head}-dirty`;
  } catch {
    return 'unknown';
  }
}

/** Empties the output folder but keeps the owner's marked listening sheets. */
function wipe(): void {
  if (!existsSync(OUT)) return;
  for (const entry of readdirSync(OUT)) {
    if (entry !== 'listening') rmSync(join(OUT, entry), { recursive: true, force: true });
  }
}

const { paths, only } = parseArgs(process.argv.slice(2));
const found = discover(paths);
if (found.missing.length > 0) usage(`no such path: ${found.missing.join(', ')}`);
for (const folder of found.empty) console.info(`${folder}/ has no Guitar Pro files yet`);
if (found.files.length === 0) {
  // A previous run's summary must not be left looking current.
  wipe();
  console.info('Nothing to check.');
  process.exit(0);
}
console.info(`Checking ${String(found.files.length)} file${found.files.length === 1 ? '' : 's'}.`);

wipe();
process.env['REPRISE_CHECK_FILES'] = JSON.stringify(found.files);
process.env['REPRISE_CHECK_ONLY'] = only.join(',');
process.env['REPRISE_CHECK_COMMIT'] = commit();
const skips = preflight(checksFor(only), {
  soundfont: soundfontPresent(),
  ci: (process.env['CI'] ?? '') !== '',
});
process.env[SKIPS_ENV] = JSON.stringify(skips);
for (const note of new Set(Object.values(skips))) console.info(note);

const vitest = await startVitest([], {
  config: fileURLToPath(new URL('vitest.config.ts', import.meta.url)),
  watch: false,
  ...(only.length > 0 && { project: only.map((name) => `check-${name}`) }),
});
const testsFailed =
  vitest.state.getCountOfFailedTests() > 0 || vitest.state.getUnhandledErrors().length > 0;
await vitest.close();

const summaryPath = join(OUT, 'summary.json');
let verdict = false;
if (existsSync(summaryPath)) {
  const summary: unknown = JSON.parse(readFileSync(summaryPath, 'utf8'));
  verdict =
    typeof summary === 'object' &&
    summary !== null &&
    'failed' in summary &&
    summary.failed === 0 &&
    'crashed' in summary &&
    summary.crashed === 0 &&
    'stale' in summary &&
    Array.isArray(summary.stale) &&
    summary.stale.length === 0;
}
process.exit(verdict && !testsFailed ? 0 : 1);

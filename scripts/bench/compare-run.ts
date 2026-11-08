/**
 * `gate <rev>` decides whether a watched path changed since <rev>; `<base-dir> [--rounds N]
 * [--accept-slower]` benches the budgeted rows in that tree and in this one, alternating, and
 * fails on a relative slowdown. The logic lives in compare.ts.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadBudgets } from './budgets.ts';
import {
  ROUNDS,
  benchFiles,
  comparedRows,
  markdownSummary,
  readReport,
  testNamePattern,
  textTable,
  failureLines,
  touchesWatched,
  verdict,
  watchedPaths,
  type Workspaces,
} from './compare.ts';

const head = process.cwd();

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function field(json: unknown, key: string): unknown {
  return typeof json === 'object' && json !== null ? Reflect.get(json, key) : undefined;
}

function workspaces(): Workspaces {
  const dirs = ['packages', 'apps'].flatMap((parent) =>
    existsSync(join(head, parent))
      ? readdirSync(join(head, parent)).map((name) => `${parent}/${name}`)
      : [],
  );
  const manifests = dirs.flatMap((dir) => {
    const path = join(head, dir, 'package.json');
    return existsSync(path) ? [{ dir, json: readJson(path) }] : [];
  });
  const byName = new Map(
    manifests.flatMap(({ dir, json }) => {
      const name = field(json, 'name');
      return typeof name === 'string' ? [[name, dir] as const] : [];
    }),
  );
  return new Map(
    manifests.map(({ dir, json }) => {
      const dependencies = ['dependencies', 'devDependencies'].flatMap((key) => {
        const group = field(json, key);
        if (typeof group !== 'object' || group === null) return [];
        return Object.entries(group).flatMap(([name, range]) => {
          const target = byName.get(name);
          return typeof range === 'string' && range.startsWith('workspace:') && target
            ? [target]
            : [];
        });
      });
      return [dir, dependencies];
    }),
  );
}

function appendTo(variable: string, text: string): void {
  const path = process.env[variable];
  if (path) appendFileSync(path, text);
}

function gate(rev: string): void {
  const { budgets, error } = loadBudgets(join(head, 'docs/plans/roadmap.md'), process.env);
  const changed = git(head, ['diff', '--name-only', rev, 'HEAD']).split('\n').filter(Boolean);
  // A table that does not parse is itself a reason to run: the comparison reports the error.
  const run =
    error !== '' || touchesWatched(changed, watchedPaths(comparedRows(budgets), workspaces()));
  console.log(`run=${String(run)}`);
  appendTo('GITHUB_OUTPUT', `run=${String(run)}\n`);
  if (!run) {
    const note = 'No watched path changed; not benched.';
    console.log(note);
    appendTo('GITHUB_STEP_SUMMARY', `${note}\n`);
  }
}

function measure(
  cwd: string,
  files: string[],
  pattern: string,
  output: string,
): Map<string, number> {
  const args = [
    'exec',
    'vitest',
    'bench',
    '--run',
    ...files,
    '-t',
    pattern,
    '--reporter=dot',
    '--reporter=json',
    `--outputFile.json=${output}`,
  ];
  const result = spawnSync('pnpm', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  // A ceiling failure exits 1 but still measured; only a run with no measurement is a crash.
  try {
    return readReport(readJson(output));
  } catch {
    console.error(`No report from ${cwd} (exit ${String(result.status)}).`);
    return new Map();
  }
}

function compare(baseDir: string, rounds: number, accepted: boolean): void {
  if (!existsSync(join(baseDir, 'node_modules'))) {
    throw new Error(`${baseDir} has no node_modules; run pnpm install there first.`);
  }
  const { budgets, error } = loadBudgets(join(head, 'docs/plans/roadmap.md'), process.env);
  if (error !== '') throw new Error(error);
  const rows = comparedRows(budgets);
  const files = benchFiles(rows);
  const pattern = testNamePattern(rows.map(({ metric }) => metric));
  const dir = mkdtempSync(join(tmpdir(), 'bench-compare-'));

  const measured: Record<'base' | 'head', Map<string, number>[]> = { base: [], head: [] };
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? (['base', 'head'] as const) : (['head', 'base'] as const);
    for (const side of order) {
      const started = performance.now();
      const result = measure(
        side === 'base' ? baseDir : head,
        files,
        pattern,
        join(dir, `${side}-${String(round)}.json`),
      );
      measured[side].push(result);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      console.log(
        `round ${String(round + 1)}/${String(rounds)}, ${side === 'base' ? 'main' : 'PR'}: ${seconds} s`,
      );
    }
  }

  const verdicts = rows.map((row) =>
    verdict(
      row,
      measured.base.map((result) => result.get(row.metric)),
      measured.head.map((result) => result.get(row.metric)),
      accepted,
    ),
  );
  const cpu = cpus();
  const title =
    `Bench against main: ${String(rounds)} rounds, alternating, on ${cpu[0]?.model.trim() ?? 'unknown CPU'} ` +
    `×${String(cpu.length)}, Node ${process.version} (PR ${git(head, ['rev-parse', '--short=7', 'HEAD'])}, ` +
    `main ${git(baseDir, ['rev-parse', '--short=7', 'HEAD'])})`;
  console.log(`\n${textTable(verdicts, title)}`);
  for (const line of failureLines(verdicts)) console.log(line);
  appendTo('GITHUB_STEP_SUMMARY', `${markdownSummary(verdicts, rounds, title)}\n`);
  if (verdicts.some(({ status }) => status === 'slower' || status === 'not measured')) {
    process.exitCode = 1;
  }
}

const [first, ...rest] = process.argv.slice(2);
if (first === 'gate' && rest[0] !== undefined) {
  gate(rest[0]);
} else if (first !== undefined && first !== 'gate') {
  const at = rest.indexOf('--rounds');
  const rounds = at === -1 ? ROUNDS : Number(rest[at + 1]);
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('--rounds takes a positive integer');
  compare(first, rounds, rest.includes('--accept-slower'));
} else {
  console.error('Usage: compare-run.ts gate <rev> | <base-dir> [--rounds N] [--accept-slower]');
  process.exitCode = 2;
}

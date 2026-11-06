/**
 * Accepts the visual suite's screenshots from a failed CI run as the new baselines. The committed
 * baselines are CI's own Linux images, so they are never written locally: CI uploads each failing
 * scene's actual image (or, for a missing baseline, the reference it wrote) as the `visual-diff`
 * artifact, and this copies those over the baselines for the PR's review to look at.
 *
 *   pnpm visual:accept            # the latest ci.yml run of HEAD
 *   pnpm visual:accept <run-id>
 *
 * Needs `GH_TOKEN` exported as AGENTS.md describes.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { argv, exit } from 'node:process';

const ROOT = join(import.meta.dirname, '../..');
const ARTIFACT = 'visual-diff';
const ATTACHMENTS = '.vitest/attachments/';
const IMAGE =
  /^(?<dir>.+)\/(?<file>[^/]+\.visual\.test\.tsx)\/(?<name>.+)-(?:actual|reference)-chromium-linux\.png$/;

/**
 * Where an artifact image goes, relative to the repository root, or `undefined` for anything
 * that is not an actual or reference image (diffs, Vitest's hashed attachments).
 */
export function baselinePath(artifactPath: string): string | undefined {
  const normalized = artifactPath.split(sep).join('/');
  const at = normalized.indexOf(ATTACHMENTS);
  const path = at === -1 ? normalized : normalized.slice(at + ATTACHMENTS.length);
  const groups = IMAGE.exec(path)?.groups;
  if (!groups) return undefined;
  return `apps/web/${groups['dir'] ?? ''}/__screenshots__/${groups['file'] ?? ''}/${groups['name'] ?? ''}-chromium-linux.png`;
}

function gh(...args: string[]): string {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8' });
}

interface Run {
  databaseId: number;
  status: string;
  conclusion: string;
}

function isRun(value: unknown): value is Run {
  return (
    typeof value === 'object' &&
    value !== null &&
    'databaseId' in value &&
    'status' in value &&
    'conclusion' in value
  );
}

function pickRun(id: string | undefined): string {
  const runs: unknown = JSON.parse(
    id === undefined
      ? gh(
          'run',
          'list',
          '--commit',
          execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
          '--workflow',
          'ci.yml',
          '--limit',
          '1',
          '--json',
          'databaseId,status,conclusion',
        )
      : `[${gh('run', 'view', id, '--json', 'databaseId,status,conclusion')}]`,
  );
  const run: unknown = Array.isArray(runs) ? runs[0] : undefined;
  if (!isRun(run)) throw new Error(id ? `no run ${id}` : 'no ci.yml run for HEAD; push first');
  if (run.status !== 'completed' || run.conclusion !== 'failure') {
    throw new Error(
      `run ${String(run.databaseId)} is ${run.status}/${run.conclusion}; only a failed run has diffs`,
    );
  }
  return String(run.databaseId);
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function main(): void {
  const run = pickRun(argv[2]);
  const dir = mkdtempSync(join(tmpdir(), 'reprise-visual-'));
  gh('run', 'download', run, '--name', ARTIFACT, '--dir', dir);
  const accepted: string[] = [];
  for (const file of files(dir)) {
    const target = baselinePath(relative(dir, file));
    if (target === undefined) continue;
    mkdirSync(dirname(join(ROOT, target)), { recursive: true });
    copyFileSync(file, join(ROOT, target));
    accepted.push(target);
  }
  if (accepted.length === 0) {
    console.error(`Run ${run}'s ${ARTIFACT} artifact holds no screenshots to accept.`);
    exit(1);
  }
  for (const target of accepted.sort()) console.log(`accepted ${target}`);
  console.log(
    `${String(accepted.length)} baselines from run ${run}; look at each before committing.`,
  );
}

if (import.meta.main) main();

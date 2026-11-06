/**
 * Accepts the visual suite's screenshots from a failed CI run as the new baselines. The committed
 * baselines are CI's own Linux images, so they are never written locally: CI uploads each failing
 * scene's actual image (or, for a missing baseline, the reference it wrote) and the suite's JSON
 * report as the `visual-diff` artifact, and this copies the images over the baselines for the PR's
 * review to look at. It refuses a run of another commit than HEAD, a run whose Visual step did not
 * fail, and one where any test failed for a reason other than an image difference.
 *
 *   pnpm visual:accept            # the latest ci.yml run of HEAD
 *   pnpm visual:accept <run-id>
 *
 * Needs `GH_TOKEN` exported as AGENTS.md describes.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import process, { argv } from 'node:process';

const ROOT = join(import.meta.dirname, '../..');
const ARTIFACT = 'visual-diff';
const ATTACHMENTS = '.vitest/attachments/';
/** Written by the Visual step's JSON reporter, under the uploaded attachments directory. */
export const REPORT = 'visual-report.json';
const VISUAL_STEP = 'Visual';
const IMAGE =
  /^(?<dir>.+)\/(?<file>[^/]+\.visual\.test\.tsx)\/(?<name>.+)-(?:actual|reference)-chromium-linux\.png$/;
// toMatchScreenshot's two messages for an image difference; anything else is a real failure.
const IMAGE_FAILURE =
  /^\s*(?:Screenshot does not match the stored reference\.|No existing reference screenshot found)/m;

/**
 * Where an artifact image goes, relative to the repository root, or `undefined` for anything
 * that is not an actual or reference image (diffs, Vitest's hashed attachments, the report).
 */
export function baselinePath(artifactPath: string): string | undefined {
  const normalized = artifactPath.split(sep).join('/');
  const at = normalized.indexOf(ATTACHMENTS);
  const path = at === -1 ? normalized : normalized.slice(at + ATTACHMENTS.length);
  const groups = IMAGE.exec(path)?.groups;
  if (!groups) return undefined;
  return `apps/web/${groups['dir'] ?? ''}/__screenshots__/${groups['file'] ?? ''}/${groups['name'] ?? ''}-chromium-linux.png`;
}

export interface Run {
  databaseId: number;
  status: string;
  headSha: string;
  jobs: { steps: { name: string; conclusion: string }[] }[];
}

/** Why `run` cannot be accepted at commit `head`, or `undefined` when it can. */
export function runRefusal(run: Run, head: string): string | undefined {
  const id = String(run.databaseId);
  if (run.status !== 'completed') return `run ${id} is ${run.status}; wait for it to finish`;
  if (run.headSha !== head) {
    return `run ${id} is of ${run.headSha.slice(0, 7)}, not HEAD ${head.slice(0, 7)}`;
  }
  const step = run.jobs.flatMap(({ steps }) => steps).find(({ name }) => name === VISUAL_STEP);
  if (step?.conclusion !== 'failure') {
    return `run ${id}'s ${VISUAL_STEP} step is ${step?.conclusion ?? 'missing'}; only a failed one has images to accept`;
  }
  return undefined;
}

/** The failures in a Vitest JSON report that are not image differences, one line each. */
export function otherFailures(report: unknown): string[] {
  if (!isReport(report)) return ['the report is not a Vitest JSON report'];
  return report.testResults.flatMap((file) => [
    ...(file.message ? [`${file.name}: ${firstLine(file.message)}`] : []),
    ...file.assertionResults
      .filter(({ status }) => status === 'failed')
      .filter(
        ({ failureMessages }) =>
          failureMessages.length === 0 ||
          failureMessages.some((message) => !IMAGE_FAILURE.test(plain(message))),
      )
      .map(
        ({ fullName, failureMessages }) => `${fullName}: ${firstLine(failureMessages.join('\n'))}`,
      ),
  ]);
}

interface Report {
  testResults: {
    name: string;
    message: string;
    assertionResults: { fullName: string; status: string; failureMessages: string[] }[];
  }[];
}

function isReport(value: unknown): value is Report {
  return (
    typeof value === 'object' &&
    value !== null &&
    'testResults' in value &&
    Array.isArray(value.testResults)
  );
}

function plain(message: string): string {
  // eslint-disable-next-line no-control-regex -- strips the ANSI colours Vitest writes into messages
  return message.replaceAll(/\u001b\[[0-9;]*m/g, '');
}

function firstLine(message: string): string {
  return (
    plain(message)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}

function isRun(value: unknown): value is Run {
  return (
    typeof value === 'object' &&
    value !== null &&
    'databaseId' in value &&
    'status' in value &&
    'headSha' in value &&
    'jobs' in value &&
    Array.isArray(value.jobs)
  );
}

class Refusal extends Error {}

function gh(...args: string[]): string {
  try {
    return execFileSync('gh', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Refusal(`gh ${args.slice(0, 2).join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

function pickRun(id: string | undefined, head: string): string {
  const runId =
    id ??
    gh(
      'run',
      'list',
      '--commit',
      head,
      '--workflow',
      'ci.yml',
      '--limit',
      '1',
      '--json',
      'databaseId',
      '--jq',
      '.[0].databaseId',
    ).trim();
  if (!runId) throw new Refusal('no ci.yml run for HEAD; push first');
  const run: unknown = JSON.parse(
    gh('run', 'view', runId, '--json', 'databaseId,status,headSha,jobs'),
  );
  if (!isRun(run)) throw new Refusal(`gh returned no run ${runId}`);
  const refusal = runRefusal(run, head);
  if (refusal) throw new Refusal(refusal);
  return runId;
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function accept(run: string, dir: string): void {
  try {
    execFileSync('gh', ['run', 'download', run, '--name', ARTIFACT, '--dir', dir], {
      cwd: ROOT,
      stdio: 'ignore',
    });
  } catch {
    throw new Refusal(`run ${run} has no ${ARTIFACT} artifact to download`);
  }
  const report = files(dir).find((file) => file.endsWith(`/${REPORT}`));
  if (!report) throw new Refusal(`run ${run}'s ${ARTIFACT} artifact holds no ${REPORT}`);
  const others = otherFailures(JSON.parse(readFileSync(report, 'utf8')));
  if (others.length > 0) {
    throw new Refusal(
      [
        `run ${run} failed for more than image differences:`,
        ...others.map((line) => `  ${line}`),
      ].join('\n'),
    );
  }
  const accepted: string[] = [];
  for (const file of files(dir)) {
    const target = baselinePath(relative(dir, file));
    if (target === undefined) continue;
    mkdirSync(dirname(join(ROOT, target)), { recursive: true });
    copyFileSync(file, join(ROOT, target));
    accepted.push(target);
  }
  if (accepted.length === 0)
    throw new Refusal(`run ${run}'s ${ARTIFACT} artifact holds no screenshots to accept`);
  for (const target of accepted.sort()) console.log(`accepted ${target}`);
  console.log(
    `${String(accepted.length)} baselines from run ${run}; look at each before committing.`,
  );
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), 'reprise-visual-'));
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    accept(pickRun(argv[2], head), dir);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(error.message);
    // Not exit(), so the finally still removes the download.
    process.exitCode = 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) main();

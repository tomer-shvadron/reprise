/**
 * Collects every check's record from `task.meta.check`, judges the run against the known list
 * and writes `.check-files/`. `run.ts` reads `summary.json` for the exit code.
 */
import { platform, release } from 'node:os';

import type { Reporter, SerializedError, TestModule } from 'vitest/node';

import { OUT_DIR, ROOT_DIR } from './files.ts';
import { isCheckRecord } from './meta.ts';
import type { CheckFile, CheckRecord } from './meta.ts';
import { checksFor, skipsFromEnv } from './preflight.ts';
import { FILES_ENV, filesFromEnv } from './provide-files.ts';
import {
  classify,
  draftFileName,
  passed,
  renderDraft,
  renderSummary,
  writeReports,
} from './report.ts';

export const ONLY_ENV = 'REPRISE_CHECK_ONLY';
export const COMMIT_ENV = 'REPRISE_CHECK_COMMIT';

export default class CheckFilesReporter implements Reporter {
  onTestRunEnd(modules: readonly TestModule[], unhandled: readonly SerializedError[]): void {
    if (process.env[FILES_ENV] === undefined) return;
    const files: CheckFile[] = filesFromEnv().map((entry, index) => ({ ...entry, index }));
    const only = (process.env[ONLY_ENV] ?? '').split(',').filter((name) => name !== '');
    const records: CheckRecord[] = [];
    const crashes = new Map<string, string>();
    for (const module of modules) {
      for (const test of module.children.allTests()) {
        const meta = test.meta();
        const target = meta.checkTarget;
        if (!target) continue;
        const result = test.result();
        if (result.state === 'failed') {
          const message = result.errors[0]?.message ?? 'the test failed';
          crashes.set(`${target.file}|${target.check}`, message.split('\n')[0] ?? message);
        } else if (isCheckRecord(meta.check)) {
          records.push(meta.check);
        }
      }
    }
    const env = {
      commit: process.env[COMMIT_ENV] ?? 'unknown',
      os: `${platform()} ${release()}`,
    };
    const run = classify(files, checksFor(only), records, crashes, undefined, skipsFromEnv());
    if (unhandled.length > 0) run.summary.crashed += unhandled.length;
    writeReports(run, env, OUT_DIR, ROOT_DIR);
    const out: string[] = ['', renderSummary(run, env)];
    for (const draft of run.drafts) {
      out.push(
        `----- draft ${String(draft.number)} (${draftFileName(draft)}) -----`,
        renderDraft(draft, env),
      );
    }
    if (run.drafts.length > 0) out.push(`----- end of drafts -----`);
    out.push(
      `Report: ${OUT_DIR}/summary.md`,
      passed(run.summary) ? 'check:files passed.' : 'check:files FAILED.',
      '',
    );
    process.stdout.write(out.join('\n'));
  }
}

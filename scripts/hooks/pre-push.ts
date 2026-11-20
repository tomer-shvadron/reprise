/**
 * The pre-push hook's work: run the tests related to every TypeScript file changed between the
 * pushed commits and their merge-base with origin/main. Git feeds the refs on stdin; see
 * CONTRIBUTING.md#git-hooks.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { parsePushedRefs, vitestRelatedArgs } from './related.ts';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });

const refs = parsePushedRefs(readFileSync(0, 'utf8'));
const changed = new Set<string>();
for (const { localSha } of refs) {
  // The merge-base keeps a branch that merged origin/main to its own changes, and a new branch
  // with no upstream still has one. Without origin/main there is no base to compare with: fail
  // loudly rather than push untested.
  let base: string;
  try {
    base = git('merge-base', localSha, 'origin/main').trim();
  } catch {
    console.error(
      'pre-push: no merge-base with origin/main; run `git fetch origin` and push again',
    );
    process.exit(1);
  }
  const files = git('diff', '--name-only', '--diff-filter=ACMR', '-z', base, localSha);
  // A path deleted again before the push is not in the diff; Vitest rejects a missing file.
  for (const file of files.split('\0').filter(Boolean)) if (existsSync(file)) changed.add(file);
}

const args = vitestRelatedArgs([...changed]);
if (args === null) {
  console.log('pre-push: no TypeScript changes to test');
  process.exit(0);
}
console.log(`pre-push: running the tests related to ${String(args.length - 4)} changed file(s)`);
const run = spawnSync('pnpm', ['exec', 'vitest', ...args], { stdio: 'inherit' });
process.exit(run.status ?? 1);

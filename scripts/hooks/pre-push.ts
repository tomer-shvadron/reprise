/**
 * The pre-push hook's work: run the tests related to every TypeScript file changed between the
 * pushed commits and their merge-base with origin/main. Git feeds the refs on stdin; see
 * CONTRIBUTING.md#git-hooks.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { platform } from 'node:process';

import { notCheckedOut, parsePushedRefs, typescriptSources, vitestRelatedArgs } from './related.ts';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });

const refs = parsePushedRefs(readFileSync(0, 'utf8'));

// Vitest reads the working tree, so only the checked-out commit can be tested: another ref would
// be tested as whatever happens to be checked out, or as nothing, and pass.
const elsewhere = notCheckedOut(refs, git('rev-parse', 'HEAD').trim());
if (elsewhere.length > 0) {
  console.error(
    `pre-push: ${elsewhere.map((ref) => ref.localRef).join(', ')} is not the checked-out commit, ` +
      'so its tests cannot run here. Check the branch out, or push it from its own worktree.',
  );
  process.exit(1);
}
if (git('status', '--porcelain', '--untracked-files=no').trim() !== '') {
  console.warn('pre-push: uncommitted changes are in the tree; they are tested, not only the push');
}

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
  // --diff-filter drops deleted paths, which Vitest would reject as missing files.
  for (const file of files.split('\0').filter(Boolean)) changed.add(file);
}

const args = vitestRelatedArgs([...changed]);
if (args === null) {
  console.log('pre-push: no TypeScript changes to test');
  process.exit(0);
}
console.log(
  `pre-push: running the tests related to ${String(typescriptSources([...changed]).length)} changed file(s)`,
);
// pnpm is pnpm.cmd on Windows, which spawn only finds through a shell.
const run = spawnSync('pnpm', ['exec', 'vitest', ...args], {
  stdio: 'inherit',
  shell: platform === 'win32',
});
if (run.error) console.error(`pre-push: could not run vitest: ${run.error.message}`);
process.exit(run.status ?? 1);

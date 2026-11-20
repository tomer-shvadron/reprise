import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** @param {string[]} args */
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const root = git('rev-parse', '--show-toplevel').trim();
// The hook passes --diff-filter=ACMRD so a delete-only commit still reaches `tsc -b`; every other
// task drops the deleted paths, which ESLint and Prettier would reject as missing.
const deleted = new Set(
  git('diff', '--cached', '--name-only', '--diff-filter=D', '-z')
    .split('\0')
    .filter(Boolean)
    .map((file) => path.resolve(root, file).replaceAll('\\', '/')),
);

// lint-staged splits a returned command on spaces unless the argument is quoted.
/** @param {readonly string[]} files */
const args = (files) => files.map((file) => `"${file}"`).join(' ');

/** @param {((files: readonly string[]) => string)[]} commands */
const live =
  (...commands) =>
  /** @param {readonly string[]} files */
  (files) => {
    const kept = files.filter((file) => !deleted.has(file));
    return kept.length === 0 ? [] : commands.map((command) => command(kept));
  };

const CODE = 'js,mjs,cjs,ts,mts,cts,tsx';
const PRETTIER_ONLY = 'json,md,yaml,yml,css,html';

// First in each list, so it reads every file before ESLint or Prettier can rewrite it; the three
// globs split the staged files between them, since tasks for different globs run concurrently.
/** @param {readonly string[]} files */
const conflicts = (files) => `node scripts/conflicts/check.ts ${args(files)}`;

// --no-warn-ignored: apps/web/public/ is in ESLint's ignores, and a staged file there is not a failure.
/** @type {import('lint-staged').Configuration} */
export default {
  [`*.{${CODE}}`]: live(
    conflicts,
    (files) => `eslint --fix --max-warnings 0 --no-warn-ignored ${args(files)}`,
    (files) => `prettier --write ${args(files)}`,
  ),
  [`*.{${PRETTIER_ONLY}}`]: live(conflicts, (files) => `prettier --write ${args(files)}`),
  [`!(*.{${CODE},${PRETTIER_ONLY}})`]: live(conflicts),
  '*': () => 'tsc -b',
};

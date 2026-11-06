import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** @param {string[]} args */
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const root = git('rev-parse', '--show-toplevel').trim();
// The hook passes --diff-filter=ACMRD so a delete-only commit still reaches `tsc -b`; every other
// task drops the deleted paths, which ESLint, Prettier and Vitest would reject as missing.
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

// The browser-mode audio project joins only when a file under packages/audio is staged: every
// audio test imports the model, so a model-only commit would otherwise launch Chromium.
const AUDIO = /[\\/]packages[\\/]audio[\\/]/;

/** @type {import('lint-staged').Configuration} */
export default {
  '*.{js,mjs,cjs,ts,mts,cts,tsx}': live(
    (files) => `eslint --fix --max-warnings 0 ${args(files)}`,
    (files) => `prettier --write ${args(files)}`,
  ),
  '*.{json,md,yaml,yml,css,html}': live((files) => `prettier --write ${args(files)}`),
  '*.{ts,mts,cts,tsx}': live(
    (files) =>
      `vitest related --run ${files.some((file) => AUDIO.test(file)) ? '' : '--project=!audio '}${args(files)}`,
  ),
  '*': () => 'tsc -b',
};

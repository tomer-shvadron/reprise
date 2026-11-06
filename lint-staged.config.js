// The browser-mode audio project joins only when a file under packages/audio is staged: every
// audio test imports the model, so a model-only commit would otherwise launch Chromium.
const AUDIO = /[\\/]packages[\\/]audio[\\/]/;

/** @type {import('lint-staged').Configuration} */
export default {
  '*.{js,mjs,cjs,ts,mts,cts,tsx}': ['eslint --fix --max-warnings 0', 'prettier --write'],
  '*.{json,md,yaml,yml,css,html}': 'prettier --write',
  '*.{ts,mts,cts,tsx}': (files) =>
    `vitest related --run ${files.some((file) => AUDIO.test(file)) ? '' : '--project=!audio '}${files.join(' ')}`,
  '*.{js,mjs,cjs,ts,mts,cts,tsx,json}': () => 'tsc -b',
};

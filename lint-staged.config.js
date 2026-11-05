/** @type {import('lint-staged').Configuration} */
export default {
  '*.{js,mjs,cjs,ts,mts,cts,tsx}': ['eslint --fix --max-warnings 0', 'prettier --write'],
  '*.{json,md,yaml,yml,css,html}': 'prettier --write',
};

/** @type {import('lint-staged').Configuration} */
export default {
  '*.{js,ts,tsx}': ['eslint --fix --max-warnings 0', 'prettier --write'],
  '*.{json,md,yaml,yml,css,html}': 'prettier --write',
};

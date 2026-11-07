// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { flatConfigs as importX } from 'eslint-plugin-import-x';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import { configs as tseslint } from 'typescript-eslint';

const reactRecommended = react.configs.flat.recommended;
const reactJsxRuntime = react.configs.flat['jsx-runtime'];
if (!reactRecommended || !reactJsxRuntime) {
  throw new Error('eslint-plugin-react no longer ships the flat configs this file extends');
}

const ARCHITECTURE = 'docs/specs/architecture.md';

/** @param {string} name @param {string} rule @param {string} [doc] */
const boundary = (name, rule, doc = ARCHITECTURE) => `Boundary "${name}": ${rule} (${doc}).`;

const FRAMEWORK_FREE = boundary(
  'framework-free-packages',
  'packages/* may not import react, react-dom, @radix-ui/*, zustand or dexie',
);
const ENGINE_ISOLATION = boundary(
  'engine-isolation',
  '@reprise/formats, @reprise/layout and @reprise/audio never import each other; shared helpers live in @reprise/model',
);
const MODEL_STANDS_ALONE = boundary(
  'model-has-no-workspace-dependencies',
  '@reprise/model imports no workspace package',
);
const DEPENDENCY_EDGES = boundary(
  'allowed-dependency-edges',
  'only formats/layout/audio -> model, web -> model, formats, layout, audio and desktop -> web (types only) are allowed',
);
const ROOT_IMPORTS_ONLY = boundary(
  'root-imports-only',
  'import a package through its root export (@reprise/x); its index.ts is the public API',
);
const TESTING_IN_TESTS = boundary(
  'testing-entry-in-tests',
  '@reprise/model/testing and @reprise/audio/testing, the only allowed subpaths, are imported only from test files',
);
const ELECTRON_IN_DESKTOP = boundary(
  'electron-only-in-desktop',
  'electron is imported only inside apps/desktop',
);
const ORACLE_IN_TESTS = boundary(
  'alphatab-only-in-oracle-tests',
  '@coderline/alphatab, the dev-only oracle, is imported only under packages/formats/test/ and scripts/',
  'docs/reference/file-formats.md, "Oracle"',
);

/**
 * `typeOnly` edges admit `import type` alone: desktop needs web's bridge types, never its code.
 * `oracle` globs, relative to `dir`, are the test files that may import alphaTab.
 * @typedef {{ name: string; dir: string; allowed: string[]; typeOnly?: string[]; oracle?: string[] }} Workspace
 * @type {Workspace[]}
 */
const WORKSPACES = [
  { name: 'model', dir: 'packages/model', allowed: [] },
  { name: 'formats', dir: 'packages/formats', allowed: ['model'], oracle: ['test/**/*.ts'] },
  { name: 'layout', dir: 'packages/layout', allowed: ['model'] },
  { name: 'audio', dir: 'packages/audio', allowed: ['model'] },
  { name: 'web', dir: 'apps/web', allowed: ['model', 'formats', 'layout', 'audio'] },
  { name: 'desktop', dir: 'apps/desktop', allowed: [], typeOnly: ['web'] },
];
const ENGINES = new Set(['formats', 'layout', 'audio']);
const TEST_FILES = ['**/*.test.{ts,tsx}', '**/*.bench.{ts,tsx}', '**/test/**/*.{ts,tsx}'];
const UI_LIBRARIES = ['react', 'react-dom', 'zustand', 'dexie'];

/** @param {string} self @param {string} other */
function edgeMessage(self, other) {
  if (self === 'model') return MODEL_STANDS_ALONE;
  if (ENGINES.has(self) && ENGINES.has(other)) return ENGINE_ISOLATION;
  return DEPENDENCY_EDGES;
}

/** The package itself or any subpath of it. @param {string} name */
const packageSpecifier = (name) => `^${name}(?:/|$)`;

/** @typedef {{ regex: string; message: string; allowTypeImports?: boolean }} Restriction */

const ORACLE = { regex: packageSpecifier('@coderline/alphatab'), message: ORACLE_IN_TESTS };

/** @param {Restriction[]} patterns @returns {import('eslint').Linter.RulesRecord} */
const restrictImports = (patterns) => ({
  '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
  'no-restricted-syntax': [
    'error',
    ...patterns.map(({ regex, message }) => ({
      selector: `ImportExpression > Literal[value=/${regex.replaceAll('/', String.raw`\/`)}/]`,
      message,
    })),
  ],
});

/**
 * Each boundary is a regex over the import specifier, so one list feeds both rules:
 * `no-restricted-imports` sees static imports and re-exports, `no-restricted-syntax` the
 * `import()` calls it does not visit. The typescript-eslint variant of the first is the core
 * rule plus `allowTypeImports`, which typeOnly edges need; an `import()` is always a value
 * import, so the second bans those edges too. Flat config replaces a rule's options rather than
 * merging them, so each workspace gets one entry per rule carrying every boundary that applies,
 * once for its test files, which may import the `testing` subpaths of `model` and `audio`, and
 * once for the rest;
 * oracle test files are a third entry, the only one without the alphaTab ban.
 * @param {Workspace} workspace
 * @returns {import('eslint').Linter.Config[]}
 */
function workspaceBoundaries({ name: self, dir, allowed, typeOnly = [], oracle = [] }) {
  /** @type {Restriction[]} */
  const restricted = [
    { regex: String.raw`^@reprise/(?!(?:model|audio)/testing$)[^/]+/`, message: ROOT_IMPORTS_ONLY },
  ];

  for (const { name: other } of WORKSPACES) {
    if (other !== self && !allowed.includes(other)) {
      restricted.push({
        regex: packageSpecifier(`@reprise/${other}`),
        message: edgeMessage(self, other),
        ...(typeOnly.includes(other) && { allowTypeImports: true }),
      });
    }
  }
  if (dir.startsWith('packages/')) {
    restricted.push({
      regex: [...UI_LIBRARIES.map(packageSpecifier), '^@radix-ui/'].join('|'),
      message: FRAMEWORK_FREE,
    });
  }
  if (self !== 'desktop') {
    restricted.push({ regex: packageSpecifier('electron'), message: ELECTRON_IN_DESKTOP });
  }
  const tests = TEST_FILES.map((glob) => `${dir}/${glob}`);
  const oracleTests = oracle.map((glob) => `${dir}/${glob}`);

  return [
    {
      files: [`${dir}/**/*.{ts,tsx}`],
      ignores: tests,
      rules: restrictImports([
        ...restricted,
        ORACLE,
        { regex: String.raw`^@reprise/(?:model|audio)/testing$`, message: TESTING_IN_TESTS },
      ]),
    },
    { files: tests, ignores: oracleTests, rules: restrictImports([...restricted, ORACLE]) },
    ...(oracleTests.length > 0 ? [{ files: oracleTests, rules: restrictImports(restricted) }] : []),
  ];
}

export default defineConfig(
  {
    // Everything .gitignore lists as build or test output, since any of it can hold .js.
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/out/',
      '**/release/',
      '**/.tsbuild/',
      '**/.vite/',
      '**/coverage/',
      '**/playwright-report/',
      '**/test-results/',
      'docs/',
      'local-tabs/',
    ],
  },
  eslint.configs.recommended,
  tseslint.strictTypeChecked,
  importX.recommended,
  importX.typescript,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
    },
    plugins: { unicorn },
    rules: {
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      'import-x/no-self-import': 'error',
      'import-x/no-cycle': 'error',
      'import-x/no-relative-packages': 'error',
    },
  },
  {
    files: ['*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  // Files in no workspace; each workspace's own entries below replace this one for its files.
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    ignores: ['scripts/**'],
    rules: restrictImports([ORACLE]),
  },
  ...WORKSPACES.flatMap(workspaceBoundaries),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactRecommended, reactJsxRuntime, reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['apps/web/e2e/player/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'waitForTimeout',
          message: 'Wait on app state, never on time: apps/web/e2e/player/README.md',
        },
      ],
    },
  },
);

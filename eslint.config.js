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
const ALPHATAB_IN_FORMATS_TESTS = boundary(
  'alphatab-only-in-formats-tests-and-scripts',
  '@coderline/alphatab, the dev-only oracle, is imported only under packages/formats/test/ (the oracle, the files check, the gp writer read-back test) and scripts/',
  'docs/reference/file-formats.md, "Oracle"',
);

/**
 * `typeOnly` edges admit `import type` alone: desktop needs web's bridge types, never its code.
 * `alphatab` globs, relative to `dir`, are the test files that may import alphaTab.
 * @typedef {{ name: string; dir: string; allowed: string[]; typeOnly?: string[]; alphatab?: string[] }} Workspace
 * @type {Workspace[]}
 */
const WORKSPACES = [
  { name: 'model', dir: 'packages/model', allowed: [] },
  { name: 'formats', dir: 'packages/formats', allowed: ['model'], alphatab: ['test/**/*.ts'] },
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

const ALPHATAB_BAN = {
  regex: packageSpecifier('@coderline/alphatab'),
  message: ALPHATAB_IN_FORMATS_TESTS,
};

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
 * alphaTab test files are a third entry, the only one without the alphaTab ban.
 * @param {Workspace} workspace
 * @returns {import('eslint').Linter.Config[]}
 */
function workspaceBoundaries({ name: self, dir, allowed, typeOnly = [], alphatab = [] }) {
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
  const alphatabTests = alphatab.map((glob) => `${dir}/${glob}`);

  return [
    {
      files: [`${dir}/**/*.{ts,tsx}`],
      ignores: tests,
      rules: restrictImports([
        ...restricted,
        ALPHATAB_BAN,
        { regex: String.raw`^@reprise/(?:model|audio)/testing$`, message: TESTING_IN_TESTS },
      ]),
    },
    { files: tests, ignores: alphatabTests, rules: restrictImports([...restricted, ALPHATAB_BAN]) },
    ...(alphatabTests.length > 0
      ? [{ files: alphatabTests, rules: restrictImports(restricted) }]
      : []),
  ];
}

export default defineConfig(
  {
    // Everything .gitignore lists as build or test output, since any of it can hold .js.
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/out/',
      'apps/desktop/release/',
      '**/.tsbuild/',
      '**/.vite/',
      '**/coverage/',
      '**/playwright-report/',
      '**/test-results/',
      // Shipped verbatim, never bundled or typed: the theme bootstrap is a classic script.
      'apps/web/public/',
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
    rules: restrictImports([ALPHATAB_BAN]),
  },
  ...WORKSPACES.flatMap(workspaceBoundaries),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactRecommended, reactJsxRuntime, reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
  },
  {
    // Every tooltip and every `aria-keyshortcuts` goes through the shared component, so the keys a
    // control shows come from the registry (#412). Not `no-restricted-syntax`: a flat-config entry
    // replaces a rule's options, which would drop the workspace boundary bans for these files.
    files: ['apps/web/src/**/*.tsx'],
    ignores: [
      ...TEST_FILES.map((glob) => `apps/web/src/${glob}`),
      'apps/web/src/components/ui/**',
      'apps/web/src/app/command-tooltip.tsx',
    ],
    rules: {
      'react/forbid-elements': [
        'error',
        {
          forbid: [
            {
              element: 'TooltipContent',
              message:
                'use CommandTooltip (a control that runs a command) or HintTooltip from app/command-tooltip (#412)',
            },
          ],
        },
      ],
      'react/forbid-dom-props': [
        'error',
        {
          forbid: [
            {
              propName: 'aria-keyshortcuts',
              message: 'CommandTooltip sets aria-keyshortcuts so it matches the tooltip (#412)',
            },
          ],
        },
      ],
      'react/forbid-component-props': [
        'error',
        {
          forbid: [
            {
              propName: 'aria-keyshortcuts',
              message: 'CommandTooltip sets aria-keyshortcuts so it matches the tooltip (#412)',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/e2e/{player,editor}/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'waitForTimeout',
          message:
            'Wait on app state, never on time: apps/web/e2e/player/README.md (and apps/web/e2e/editor/README.md)',
        },
        {
          object: 'window',
          property: 'setTimeout',
          message:
            'Wait on app state, never on time: apps/web/e2e/player/README.md (and apps/web/e2e/editor/README.md)',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'setTimeout',
          message:
            'Wait on app state, never on time: apps/web/e2e/player/README.md (and apps/web/e2e/editor/README.md)',
        },
      ],
    },
  },
);

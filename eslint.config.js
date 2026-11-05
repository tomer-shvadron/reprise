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

/** @param {string} name @param {string} rule */
const boundary = (name, rule) => `Boundary "${name}": ${rule} (${ARCHITECTURE}).`;

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
  'only formats/layout/audio -> model and web -> model, formats, layout, audio are allowed',
);
const ROOT_IMPORTS_ONLY = boundary(
  'root-imports-only',
  'import a package through its root export (@reprise/x); its index.ts is the public API',
);
const ELECTRON_IN_DESKTOP = boundary(
  'electron-only-in-desktop',
  'electron is imported only inside apps/desktop',
);

/** @type {{ name: string; dir: string; allowed: string[] }[]} */
const WORKSPACES = [
  { name: 'model', dir: 'packages/model', allowed: [] },
  { name: 'formats', dir: 'packages/formats', allowed: ['model'] },
  { name: 'layout', dir: 'packages/layout', allowed: ['model'] },
  { name: 'audio', dir: 'packages/audio', allowed: ['model'] },
  { name: 'web', dir: 'apps/web', allowed: ['model', 'formats', 'layout', 'audio'] },
  { name: 'desktop', dir: 'apps/desktop', allowed: [] },
];
const ENGINES = new Set(['formats', 'layout', 'audio']);
const UI_LIBRARIES = ['react', 'react-dom', 'zustand', 'dexie'];

/** @param {string} self @param {string} other */
function edgeMessage(self, other) {
  if (self === 'model') return MODEL_STANDS_ALONE;
  if (ENGINES.has(self) && ENGINES.has(other)) return ENGINE_ISOLATION;
  return DEPENDENCY_EDGES;
}

/** The package itself or any subpath of it. @param {string} name */
const packageSpecifier = (name) => `^${name}(?:/|$)`;

/**
 * Each boundary is a regex over the import specifier, so one list feeds both rules:
 * `no-restricted-imports` sees static imports and re-exports, `no-restricted-syntax` the
 * `import()` calls it does not visit. Flat config replaces a rule's options rather than
 * merging them, so each workspace gets one entry per rule carrying every boundary that applies.
 * @param {{ name: string; dir: string; allowed: string[] }} workspace
 * @returns {import('eslint').Linter.Config}
 */
function workspaceBoundaries({ name: self, dir, allowed }) {
  const restricted = [{ regex: String.raw`^@reprise/[^/]+/`, message: ROOT_IMPORTS_ONLY }];

  for (const { name: other } of WORKSPACES) {
    if (other !== self && !allowed.includes(other)) {
      restricted.push({
        regex: packageSpecifier(`@reprise/${other}`),
        message: edgeMessage(self, other),
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

  return {
    files: [`${dir}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', { patterns: restricted }],
      'no-restricted-syntax': [
        'error',
        ...restricted.map(({ regex, message }) => ({
          selector: `ImportExpression > Literal[value=/${regex.replaceAll('/', String.raw`\/`)}/]`,
          message,
        })),
      ],
    },
  };
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
  ...WORKSPACES.map(workspaceBoundaries),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactRecommended, reactJsxRuntime, reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
    settings: { react: { version: '19.2' } },
  },
);

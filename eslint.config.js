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

/** @type {Record<'model' | 'formats' | 'layout' | 'audio' | 'web' | 'desktop', { dir: string; allowed: string[] }>} */
const WORKSPACES = {
  model: { dir: 'packages/model', allowed: [] },
  formats: { dir: 'packages/formats', allowed: ['model'] },
  layout: { dir: 'packages/layout', allowed: ['model'] },
  audio: { dir: 'packages/audio', allowed: ['model'] },
  web: { dir: 'apps/web', allowed: ['model', 'formats', 'layout', 'audio'] },
  desktop: { dir: 'apps/desktop', allowed: [] },
};
const ENGINES = new Set(['formats', 'layout', 'audio']);
const UI_LIBRARIES = ['react', 'react-dom', '@radix-ui', 'zustand', 'dexie'];

/** @param {keyof typeof WORKSPACES} self @param {string} other */
function edgeMessage(self, other) {
  if (self === 'model') return MODEL_STANDS_ALONE;
  if (ENGINES.has(self) && ENGINES.has(other)) return ENGINE_ISOLATION;
  return DEPENDENCY_EDGES;
}

/**
 * Flat config replaces a rule's options rather than merging them, so each workspace gets one
 * `no-restricted-imports` entry that carries every boundary that applies to it.
 * @param {keyof typeof WORKSPACES} self
 * @returns {import('eslint').Linter.Config}
 */
function workspaceBoundaries(self) {
  const { dir, allowed } = WORKSPACES[self];
  /** @type {{ name: string; message: string }[]} */
  const paths = [];
  /** @type {({ group: string[]; message: string } | { regex: string; message: string })[]} */
  const patterns = [
    { group: ['@reprise/*/**'], message: ROOT_IMPORTS_ONLY },
    // A relative path that climbs out of src/ is reaching into another workspace's files.
    { regex: String.raw`^\.\.?/(?:.*/)?(?:src|packages|apps)(?:/|$)`, message: ROOT_IMPORTS_ONLY },
  ];

  for (const other of Object.keys(WORKSPACES)) {
    if (other !== self && !allowed.includes(other)) {
      paths.push({ name: `@reprise/${other}`, message: edgeMessage(self, other) });
    }
  }
  if (dir.startsWith('packages/')) {
    patterns.push({
      group: UI_LIBRARIES.flatMap((library) =>
        library.startsWith('@') ? [`${library}/*`] : [library, `${library}/*`],
      ),
      message: FRAMEWORK_FREE,
    });
  }
  if (self !== 'desktop') {
    patterns.push({ group: ['electron', 'electron/*'], message: ELECTRON_IN_DESKTOP });
  }

  return {
    files: [`${dir}/**/*.{ts,tsx}`],
    rules: { 'no-restricted-imports': ['error', { paths, patterns }] },
  };
}

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.tsbuild/',
      '**/coverage/',
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
    },
  },
  {
    files: ['*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  ...Object.keys(WORKSPACES).map((name) =>
    workspaceBoundaries(/** @type {keyof typeof WORKSPACES} */ (name)),
  ),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactRecommended, reactJsxRuntime, reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
    settings: { react: { version: '19.2' } },
  },
);

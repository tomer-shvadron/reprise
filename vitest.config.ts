import { fileURLToPath } from 'node:url';

import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defaultExclude, defineConfig } from 'vitest/config';

import { loadBudgets } from './scripts/bench/budgets.ts';

// Audio runs in the browser; files named `*.node.test.ts` prove a module also runs under Node.
const AUDIO_NODE_TESTS = '**/*.node.test.ts';
const AUDIO_NODE_BENCHES = '**/*.node.bench.ts';

// Web code that needs real Web Audio runs in the browser; the rest of web stays in jsdom.
const WEB_BROWSER_TESTS = 'src/**/*.browser.test.{ts,tsx}';

const webAlias = { '@': fileURLToPath(new URL('apps/web/src', import.meta.url)) };

const { budgets, error: budgetsError } = loadBudgets(
  fileURLToPath(new URL('docs/plans/roadmap.md', import.meta.url)),
  process.env,
);

export default defineConfig({
  test: {
    reporters: ['verbose'],
    // Read by the *.bench.ts files through inject(); those run only under `pnpm bench`.
    provide: { budgets, budgetsError },
    // The export-getter tracker this turns off added half again to cold layout (110 ms against 70).
    benchmark: { suppressExportGetterWarnings: true },
    projects: [
      { test: { name: 'model', root: 'packages/model', environment: 'node' } },
      { test: { name: 'formats', root: 'packages/formats', environment: 'node' } },
      {
        test: {
          name: 'layout',
          root: 'packages/layout',
          environment: 'node',
          exclude: [...configDefaults.exclude, 'test/**'],
        },
      },
      {
        test: {
          name: 'layout-worker',
          root: 'packages/layout/test',
          // Proves layout runs in a Web Worker; production layout stays on the main thread.
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'audio',
          root: 'packages/audio',
          exclude: [...configDefaults.exclude, AUDIO_NODE_TESTS],
          benchmark: { exclude: [...defaultExclude, AUDIO_NODE_BENCHES] },
          // Reads the fixture corpus in Node, since audio may not import the readers.
          globalSetup: ['../../scripts/fixtures/provide-scores.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            // The suite renders through OfflineAudioContext; there is nothing on screen to capture.
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'audio-node',
          root: 'packages/audio',
          environment: 'node',
          include: [AUDIO_NODE_TESTS],
          benchmark: { include: [AUDIO_NODE_BENCHES] },
          // Reads the SF2 fixture in Node, since audio is typed without Node's modules.
          globalSetup: ['../../scripts/sounds/provide-sf2.ts'],
        },
      },
      {
        resolve: { alias: webAlias },
        test: {
          name: 'web',
          root: 'apps/web',
          environment: 'jsdom',
          exclude: [...configDefaults.exclude, WEB_BROWSER_TESTS],
          setupFiles: ['./src/test/setup.ts'],
          // Vitest empties CSS imports; score-css.test.ts reads the painter's stylesheet as text.
          css: { include: [/score\.css/] },
        },
      },
      {
        resolve: { alias: webAlias },
        test: {
          name: 'web-browser',
          root: 'apps/web',
          include: [WEB_BROWSER_TESTS],
          setupFiles: ['./src/test/browser-setup.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      { test: { name: 'desktop', root: 'apps/desktop', environment: 'node' } },
      { test: { name: 'scripts', root: 'scripts', environment: 'node' } },
    ],
  },
});

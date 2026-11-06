import { fileURLToPath } from 'node:url';

import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

// Audio runs in the browser; files named `*.node.test.ts` prove a module also runs under Node.
const AUDIO_NODE_TESTS = '**/*.node.test.ts';

export default defineConfig({
  test: {
    reporters: ['verbose'],
    projects: [
      { test: { name: 'model', root: 'packages/model', environment: 'node' } },
      { test: { name: 'formats', root: 'packages/formats', environment: 'node' } },
      { test: { name: 'layout', root: 'packages/layout', environment: 'node' } },
      {
        test: {
          name: 'audio',
          root: 'packages/audio',
          exclude: [...configDefaults.exclude, AUDIO_NODE_TESTS],
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
          // Reads the SF2 fixture in Node, since audio is typed without Node's modules.
          globalSetup: ['../../scripts/sounds/provide-sf2.ts'],
        },
      },
      {
        resolve: { alias: { '@': fileURLToPath(new URL('apps/web/src', import.meta.url)) } },
        test: {
          name: 'web',
          root: 'apps/web',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          // Vitest empties CSS imports; score-css.test.ts reads the painter's stylesheet as text.
          css: { include: [/score\.css/] },
        },
      },
      { test: { name: 'desktop', root: 'apps/desktop', environment: 'node' } },
      { test: { name: 'scripts', root: 'scripts', environment: 'node' } },
    ],
  },
});

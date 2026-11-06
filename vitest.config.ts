import { fileURLToPath } from 'node:url';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

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

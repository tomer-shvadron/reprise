import { fileURLToPath } from 'node:url';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

// The size every scene is captured in; the crop of each page has to fit inside it.
const viewport = { width: 1600, height: 2000 };

/**
 * Pixel screenshots of the score painter in Chromium. Kept out of the root config, so `pnpm test`,
 * `vitest related` and the pre-commit hook never launch it; `pnpm test:visual` and CI do.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    test: {
      name: 'visual',
      include: ['e2e/visual/**/*.visual.test.tsx'],
      globalSetup: ['../../scripts/fixtures/provide-scores.ts'],
      // A hang guard, not a budget: no visual test asserts on time (#90).
      testTimeout: 60_000,
      reporters: [
        'verbose',
        ...(process.env['GITHUB_ACTIONS'] === 'true' ? ['github-actions'] : []),
      ],
      browser: {
        enabled: true,
        // deviceScaleFactor 1 keeps the tester iframe at 1:1, so an A4 page is 794 px wide.
        provider: playwright({ contextOptions: { viewport, deviceScaleFactor: 1 } }),
        headless: true,
        viewport,
        screenshotFailures: false,
        instances: [{ browser: 'chromium' }],
        expect: {
          toMatchScreenshot: {
            comparatorName: 'pixelmatch',
            // Baselines and checks both come from CI's Linux Chromium, so the expected difference
            // is zero; ten pixels absorb a stray edge, while a stem moved 2 px changes about 40.
            comparatorOptions: { threshold: 0.1, includeAA: false, allowedMismatchedPixels: 10 },
          },
        },
      },
    },
  }),
);

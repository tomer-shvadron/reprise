import { fileURLToPath } from 'node:url';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SETUP = fileURLToPath(new URL('provide-files.ts', import.meta.url));

/**
 * The real-file pass. Kept out of the root config, so `pnpm test` and the pre-commit hook never
 * run it; `pnpm check:files` drives it through `run.ts`.
 */
export default defineConfig({
  root: ROOT,
  test: {
    // A hang guard, not a budget.
    testTimeout: 120_000,
    reporters: ['default', fileURLToPath(new URL('reporter.ts', import.meta.url))],
    projects: [
      {
        test: {
          name: 'check-formats',
          root: 'packages/formats',
          environment: 'node',
          include: ['test/files-check/**/*.check.ts'],
          globalSetup: [SETUP],
        },
      },
      {
        test: {
          name: 'check-layout',
          root: 'packages/layout/test',
          include: ['**/*.check.ts'],
          globalSetup: [SETUP],
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
          name: 'check-audio',
          root: 'packages/audio',
          include: ['src/test/**/*.check.ts'],
          globalSetup: [SETUP],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});

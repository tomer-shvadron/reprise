import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * `pnpm sfz:check`: the SFZ loader against packs on disk. Kept out of the root config, so
 * `pnpm test` never runs it; `check-sfz.ts` drives it.
 */
export default defineConfig({
  root: ROOT,
  test: {
    testTimeout: 120_000,
    // The report is the product: let it print whether or not the test passes.
    disableConsoleIntercept: true,
    projects: [
      {
        test: {
          name: 'check-sfz',
          root: 'packages/audio',
          environment: 'node',
          include: ['src/sfz/*.check.ts'],
          globalSetup: [fileURLToPath(new URL('provide-sfz-pack.ts', import.meta.url))],
        },
      },
    ],
  },
});

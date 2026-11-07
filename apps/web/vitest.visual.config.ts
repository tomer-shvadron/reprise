import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';

import { printPdf } from './e2e/visual/test/print-pdf.node.ts';
import viteConfig from './vite.config.ts';

// The size every scene is captured in; the crop of each page has to fit inside it.
const viewport = { width: 1600, height: 2000 };

const ci = process.env['GITHUB_ACTIONS'] === 'true';
const LOCAL_REFERENCES = '__local__';
const BASELINES = fileURLToPath(
  new URL('e2e/visual/__screenshots__/score.visual.test.tsx', import.meta.url),
);

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
      globalSetup: [
        '../../scripts/fixtures/provide-scores.ts',
        './e2e/visual/test/demo-server.node.ts',
      ],
      // Only CI's run reads the committed baselines, so only it can call one orphaned.
      provide: { checkOrphanBaselines: ci },
      // A hang guard, not a budget: no visual test asserts on time (#90).
      testTimeout: 60_000,
      reporters: ['verbose', ...(ci ? ['github-actions', 'json'] : [])],
      // Uploaded with the diffs, so `pnpm visual:accept` can tell image differences from failures.
      ...(ci ? { outputFile: { json: '.vitest/attachments/visual-report.json' } } : {}),
      browser: {
        enabled: true,
        provider: playwright({
          // Grayscale anti-aliasing and no hinting, so the runner's font configuration cannot
          // move a glyph edge.
          launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none'] },
          // deviceScaleFactor 1 keeps the tester iframe at 1:1, so an A4 page is 794 px wide.
          contextOptions: { viewport, deviceScaleFactor: 1 },
        }),
        headless: true,
        viewport,
        screenshotFailures: false,
        commands: {
          baselineFiles: () => (existsSync(BASELINES) ? readdirSync(BASELINES) : []),
          printPdf,
        },
        instances: [{ browser: 'chromium' }],
        expect: {
          toMatchScreenshot: {
            comparatorName: 'pixelmatch',
            // Baselines and checks both come from CI's Linux Chromium, so the expected difference
            // is zero; ten pixels absorb a stray edge, while a stem moved 2 px changes about 40.
            comparatorOptions: { threshold: 0.1, includeAA: false, allowedMismatchedPixels: 10 },
            // Outside CI a run compares against the developer's own references, in a gitignored
            // folder, so it never reads or overwrites the committed Linux baselines.
            resolveScreenshotPath: ({
              arg,
              ext,
              browserName,
              platform,
              root,
              testFileDirectory,
              testFileName,
              screenshotDirectory,
            }) =>
              join(
                root,
                testFileDirectory,
                ci ? screenshotDirectory : LOCAL_REFERENCES,
                testFileName,
                `${arg}-${browserName}-${platform}${ext}`,
              ),
          },
        },
      },
    },
  }),
);

import { defineConfig } from '@playwright/test';

const ci = process.env['CI'] !== undefined;
// Not Vite's 4173, so a preview left running is never mistaken for this build.
const PORT = 4319;
const BASE = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
  testDir: './e2e/player',
  testMatch: '*.spec.ts',
  globalSetup: './e2e/player/test/global-setup.ts',
  // Audio is realtime, and the rate, following and budget checks want the machine to themselves.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: ci,
  reporter: ci
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE,
    // Not `devices['Desktop Chrome']`: its Windows user agent makes the app take Ctrl as its
    // modifier while `ControlOrMeta` presses Cmd on a Mac.
    browserName: 'chromium',
    // The speed slider shows only from Tailwind's `lg` breakpoint.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // 127.0.0.1 is a secure context, which origin-private storage needs.
    command: `pnpm build && pnpm preview --port ${String(PORT)} --strictPort --host 127.0.0.1`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

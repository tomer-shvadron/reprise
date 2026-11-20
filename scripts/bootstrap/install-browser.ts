/**
 * The root `postinstall`: installs the Chromium headless shell the browser-mode tests and the
 * e2e suite use. `playwright install` run by hand ignores PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD (only
 * Playwright's own install hook reads it), so this checks it first: the packaging jobs in
 * release.yml set it and never use the shell, and ci.yml sets it and installs the shell in its own
 * cached step (#75). A plain local `pnpm install` leaves it unset and downloads as before.
 */
import { spawnSync } from 'node:child_process';
import { env, exit, platform } from 'node:process';

const skip = env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
if (skip !== undefined && skip !== '' && skip !== '0') {
  console.log('postinstall: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set; not installing Chromium');
  exit(0);
}

const run = spawnSync('pnpm', ['exec', 'playwright', 'install', 'chromium', '--only-shell'], {
  stdio: 'inherit',
  // pnpm is pnpm.cmd on Windows, which spawn only finds through a shell.
  shell: platform === 'win32',
});
exit(run.status ?? 1);

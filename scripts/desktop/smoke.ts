/**
 * Smoke check of the packaged desktop app: launches the unpacked build `pnpm desktop:build`
 * leaves in apps/desktop/release, opens a fixture through File → Open with the native dialog
 * stubbed, plays it, and checks the GM bank came from the app's own scheme and that the
 * GrantFileProtocolExtraPrivileges fuse is off.
 *
 *   pnpm desktop:build && pnpm desktop:smoke [executable]
 */
import { join } from 'node:path';
import process, { argv, exit } from 'node:process';

import { _electron as electron } from 'playwright';

import { loadBundle } from '../sounds/fetch-gm.ts';

const ROOT = join(import.meta.dirname, '../..');
const RELEASE = join(ROOT, 'apps/desktop/release');
const FIXTURE = join(ROOT, 'fixtures/gp5/chords.gp5');
const APP_URL = 'reprise://app/index.html';
const TIMEOUT = 30_000;
const BANK_URL = 'reprise://app/sounds/gm/GeneralUser-GS.sf2';

function packagedExecutable(): string {
  if (process.platform === 'darwin') {
    const dir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    return join(RELEASE, dir, 'Reprise.app/Contents/MacOS/Reprise');
  }
  if (process.platform === 'win32') return join(RELEASE, 'win-unpacked', 'Reprise.exe');
  throw new Error(`pnpm desktop:build makes no unpacked app on ${process.platform}`);
}

async function gmBytes(): Promise<number> {
  const sf2 = (await loadBundle()).files.find((file) => file.name === 'GeneralUser-GS.sf2');
  if (!sf2) throw new Error('scripts/sounds/gm.json lists no GeneralUser-GS.sf2');
  return sf2.bytes;
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
  console.log(`ok: ${message}`);
}

async function main(): Promise<void> {
  const app = await electron.launch({
    executablePath: argv[2] ?? packagedExecutable(),
    timeout: TIMEOUT,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(TIMEOUT);
    await page.waitForLoadState('load');
    check(page.url() === APP_URL, `the renderer loads from ${APP_URL} (got ${page.url()})`);

    const bank = await page.evaluate(async () => {
      const response = await fetch('./sounds/gm/GeneralUser-GS.sf2');
      await response.body?.cancel();
      return { status: response.status, length: Number(response.headers.get('content-length')) };
    });
    check(
      bank.status === 200 && bank.length === (await gmBytes()),
      `the scheme serves the GM bank (${JSON.stringify(bank)})`,
    );
    // out/main/index.js exists in the asar, so only the guard can make these a 404. The URL
    // parser normalizes `%2e%2e/` but not `%2e%2e%2f`, and `%5C` is a separator only on Windows.
    for (const probe of [
      './..%2Fmain%2Findex.js',
      './%2e%2e%2fmain%2findex.js',
      './..%5Cmain%5Cindex.js',
    ]) {
      const escape = await page.evaluate(async (url) => (await fetch(url)).status, probe);
      check(escape === 404, `${probe} out of the renderer answers 404 (got ${String(escape)})`);
    }

    // With the fuse on, file:// may read inside the asar and this load succeeds.
    const fileLoad = await app.evaluate(async ({ app, BrowserWindow }) => {
      const window = new BrowserWindow({ show: false });
      try {
        await window.loadFile(`${app.getAppPath()}/out/renderer/index.html`);
        return 'loaded';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      } finally {
        window.destroy();
      }
    });
    check(
      fileLoad.startsWith('ERR_FILE_NOT_FOUND'),
      `file:// is refused in the asar, so GrantFileProtocolExtraPrivileges is off (${fileLoad})`,
    );

    await app.evaluate(({ session }) => {
      const seen: string[] = [];
      Object.assign(globalThis, { repriseSmokeBankRequests: seen });
      // Unfiltered, because a URL pattern's `*` scheme does not cover custom schemes.
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        if (details.url.endsWith('.sf2')) seen.push(`${details.method} ${details.url}`);
        callback({});
      });
    });

    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, FIXTURE);
    // The menu item's click sends this; menu.test.ts covers the item itself.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'file.open');
    });
    await page.locator('[data-system-id]').first().waitFor();
    check(true, 'File → Open paints the fixture');

    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Pause' }).waitFor();
    await page
      .locator('[data-sound-status]')
      .filter({ hasText: /\d MB$/ })
      .waitFor();
    await page.waitForTimeout(1000);
    check(
      await page.getByRole('button', { name: 'Pause' }).isVisible(),
      'playback runs with the GM instruments decoded',
    );
    const bankRequests = await app.evaluate(() => {
      const seen: unknown = Reflect.get(globalThis, 'repriseSmokeBankRequests');
      return Array.isArray(seen) ? seen.map(String) : [];
    });
    check(
      bankRequests.includes(`GET ${BANK_URL}`),
      `the app's loader fetches the bank over the scheme (${bankRequests.join(', ')})`,
    );
  } finally {
    await app.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
}

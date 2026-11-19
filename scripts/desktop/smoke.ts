/**
 * Smoke check of the packaged desktop app: launches the unpacked build `pnpm desktop:build`
 * leaves in apps/desktop/release, opens a fixture through File → Open with the native dialog
 * stubbed, plays it, and checks the GM bank came from the app's own scheme and that the
 * GrantFileProtocolExtraPrivileges fuse is off.
 *
 * First it reads the fuses of the shipped app and fails if one is not as electron-builder's
 * `electronFuses` block sets it. Playwright's `_electron.launch` attaches with `--inspect`, which
 * the EnableNodeCliInspectArguments fuse refuses, so the app that is launched is a copy in the
 * temporary profile with that one fuse turned back on (scripts/desktop/fuses.ts). It also checks
 * that app.enableSandbox() holds (a window asking for nodeIntegration gets none) and that
 * app.quit() ends the process with exit code 0.
 *
 * Then it makes an edit, waits for the draft on disk, kills the app with SIGKILL, relaunches it on
 * the same profile, recovers the draft, checks the edit is there, and closes the window to check
 * the unsaved-changes prompt (Don't save closes it and removes the draft).
 *
 * The app runs under a temporary profile (REPRISE_PROFILE_DIR, read by main), deleted afterwards,
 * so the run never imports into the real ~/Music/Reprise or touches the real userData.
 *
 *   pnpm desktop:build && pnpm desktop:smoke [executable]
 */
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process, { argv } from 'node:process';

import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

// eslint-disable-next-line import-x/no-relative-packages -- csp.ts has no imports so plain Node loads it; the web package exports no tooling
import { CONTENT_SECURITY_POLICY } from '../../apps/web/src/csp.ts';
import { loadBundle } from '../sounds/fetch-gm.ts';
import {
  copyWithInspectEnabled,
  describeExpected,
  differingFuses,
  executableIn,
  fuseMismatches,
  readFuseWire,
  unpackedAppDir,
} from './fuses.ts';

const ROOT = join(import.meta.dirname, '../..');
const RELEASE = join(ROOT, 'apps/desktop/release');
const FIXTURE = join(ROOT, 'fixtures/gp5/chords.gp5');
const APP_URL = 'reprise://app/index.html';
const TIMEOUT = 30_000;
const BANK_URL = 'reprise://app/sounds/gm/GeneralUser-GS.sf2';

/** What `launch` runs: the inspect-enabled copy, or the executable given on the command line. */
let executable = argv[2] ?? '';

/** Checks the shipped fuses, then makes the copy the smoke launches (see the header). */
async function prepareApp(profileDir: string): Promise<void> {
  if (executable !== '') {
    console.log(`skipped: fuse check and flipped copy, launching ${executable} as given`);
    return;
  }
  const preload = await readFile(join(ROOT, 'apps/desktop/out/preload/index.cjs'), 'utf8');
  const requires = [...preload.matchAll(/\brequire\(([^)]*)\)/g)].map((match) => match[1]);
  check(
    requires.length === 1 && requires[0] === '"electron"',
    `the built preload requires only electron (${requires.join(', ')})`,
  );
  const shipped = unpackedAppDir(RELEASE, process.platform, process.arch);
  const wire = await readFuseWire(shipped);
  const problems = fuseMismatches(wire);
  if (problems.length > 0) throw new Error(`the shipped fuses are wrong: ${problems.join('; ')}`);
  console.log(`ok: the shipped app has the expected fuses (${describeExpected()})`);
  const copy = await copyWithInspectEnabled(shipped, join(profileDir, 'app'));
  const differing = differingFuses(wire, await readFuseWire(copy));
  check(
    differing.length === 1 && differing[0] === 'EnableNodeCliInspectArguments',
    `the copy differs from the shipped app by EnableNodeCliInspectArguments alone (${differing.join(', ')})`,
  );
  executable = executableIn(copy, process.platform);
  console.log(`ok: launching ${executable}, the shipped app with EnableNodeCliInspectArguments on`);
}

/** The exit code of a process, also when it has exited already; null when a signal ended it. */
function exitCodeOf(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });
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

const RECOVERY = 'Reprise closed with unsaved changes';

function launch(profileDir: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: executable,
    timeout: TIMEOUT,
    env: { ...process.env, REPRISE_PROFILE_DIR: profileDir },
  });
}

/** `userData/files/drafts`: where the keeper writes under the profile main was given. */
const draftsDir = (profileDir: string) => join(profileDir, 'userData', 'files', 'drafts');

async function draftNames(profileDir: string): Promise<string[]> {
  return readdir(draftsDir(profileDir)).catch(() => []);
}

/**
 * The first track's volume in the draft with this sidecar. A draft is a native `.reprise` file,
 * plain JSON, so it is parsed here: plain Node cannot import `@reprise/*` (the packages export
 * TypeScript source with extensionless imports), and scripts/node-entry-imports.test.ts guards it.
 */
async function draftVolume(profileDir: string, sidecar: string): Promise<number | undefined> {
  const bytes = await readFile(join(draftsDir(profileDir), sidecar.replace(/\.json$/, '.reprise')));
  const document: unknown = JSON.parse(bytes.toString('utf8'));
  return firstTrackVolume(document);
}

function firstTrackVolume(document: unknown): number | undefined {
  const score = isRecord(document) ? document['score'] : undefined;
  const tracks = isRecord(score) ? score['tracks'] : undefined;
  const channel = Array.isArray(tracks) && isRecord(tracks[0]) ? tracks[0]['channel'] : undefined;
  const volume = isRecord(channel) ? channel['volume'] : undefined;
  return typeof volume === 'number' ? volume : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function waitFor<T>(what: string, probe: () => Promise<T | undefined | false>): Promise<T> {
  const deadline = Date.now() + TIMEOUT;
  for (;;) {
    const found = await probe();
    if (found !== undefined && found !== false) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function volumeSlider(page: Page) {
  // The strip is labelled with the track's own name (the fixture's is "Steel Guitar"), so match
  // by prefix; the master slider is "Master volume". A fresh profile has the sidebar on, so
  // the first match is the sidebar row's slider and the mixer's is a second, hidden one.
  const slider = page.getByRole('slider', { name: /^Volume of / }).first();
  // The mixer panel is a remembered setting: F8 toggles it, so press it only when it is closed.
  if (!(await slider.isVisible())) await page.keyboard.press('F8');
  await slider.waitFor();
  return slider;
}

/** The app may be dead already (killed on purpose), which makes `close` reject. */
async function closeQuietly(running: { app?: ElectronApplication }): Promise<void> {
  await running.app?.close().catch(() => undefined);
}

async function main(profileDir: string, running: { app?: ElectronApplication }): Promise<void> {
  await prepareApp(profileDir);
  const app = await launch(profileDir);
  running.app = app;
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(TIMEOUT);
    await page.waitForLoadState('load');
    // The window is already loaded, so the collector goes in and the page reloads: every later
    // document is then watched from its first script. A worker blocked by the policy is reported
    // on the document that creates it, so a blocked worker load shows here; a violation raised
    // inside a worker's own scope does not, and the e2e fixture's console watch is the net for it.
    await page.addInitScript(() => {
      const seen: string[] = [];
      Reflect.set(globalThis, 'repriseSmokeViolations', seen);
      // The event bubbles from the document to the window. The Node lib types have no DOM, so the
      // listener is attached through Reflect.
      const listen = (event: object): void => {
        const field = (name: string): string => String(Reflect.get(event, name));
        seen.push(
          `${field('violatedDirective')} blocked ${field('blockedURI')} from ${field('sourceFile')}`,
        );
      };
      const add: unknown = Reflect.get(globalThis, 'addEventListener');
      if (typeof add === 'function') {
        Reflect.apply(add, globalThis, ['securitypolicyviolation', listen]);
      }
    });
    await page.reload();
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

    // enableSandbox() overrides a window's own webPreferences; without it `require` is a function.
    const sandboxed = await app.evaluate(async ({ BrowserWindow }) => {
      const window = new BrowserWindow({
        show: false,
        // No context isolation either: with it on, `require` never reaches the page's world, sandbox or not.
        webPreferences: { sandbox: false, nodeIntegration: true, contextIsolation: false },
      });
      try {
        await window.loadURL('about:blank');
        return String(await window.webContents.executeJavaScript('typeof require'));
      } finally {
        window.destroy();
      }
    });
    check(
      sandboxed === 'undefined',
      `app.enableSandbox() holds: nodeIntegration gets no require (typeof require is ${sandboxed})`,
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

    const policy = await page.evaluate(async () => {
      const response = await fetch('./index.html');
      return response.headers.get('content-security-policy');
    });
    check(
      policy === CONTENT_SECURITY_POLICY,
      `the scheme sends the shared policy (${String(policy)})`,
    );

    // Autosave: an edit, the draft on disk, a kill, a relaunch on the same profile, a recovery.
    await page.getByRole('button', { name: 'Pause' }).click();
    const slider = await volumeSlider(page);
    const before = Number(await slider.getAttribute('aria-valuenow'));
    await slider.focus();
    await slider.press('PageDown');
    const volume = Number(await slider.getAttribute('aria-valuenow'));
    check(volume === before - 10, `the volume edit takes (${String(before)} to ${String(volume)})`);
    check(
      (await page.title()).startsWith('● '),
      `the title marks the edit (${await page.title()})`,
    );
    // The library import writes its own files; only drafts are looked at here.
    const sidecar = await waitFor('the draft with the edit', async () => {
      const found = (await draftNames(profileDir)).find((name) => name.endsWith('.json'));
      return found !== undefined && (await draftVolume(profileDir, found)) === volume && found;
    });
    check(true, `the draft ${sidecar} holds the edit`);

    // After the open, play and edit steps: any script, style, font, worker or fetch the policy
    // blocked is a violation, and the page's own listener has recorded it.
    const violations = await page.evaluate((): string[] => {
      const seen: unknown = Reflect.get(globalThis, 'repriseSmokeViolations');
      return Array.isArray(seen) ? seen.map(String) : [];
    });
    check(violations.length === 0, `no CSP violation (${violations.join('; ') || 'none'})`);

    const exited = new Promise<void>((resolve) =>
      app.process().once('exit', () => {
        resolve();
      }),
    );
    app.process().kill('SIGKILL');
    await exited;
    check(true, 'the app was killed with SIGKILL');

    const relaunched = await launch(profileDir);
    running.app = relaunched;
    const again = await relaunched.firstWindow();
    again.setDefaultTimeout(TIMEOUT);
    const dialog = again.getByRole('dialog', { name: RECOVERY });
    await dialog.waitFor();
    check(true, 'the relaunch offers the draft');
    await dialog.getByRole('button', { name: /^Recover / }).click();
    await again.locator('[data-system-id]').first().waitFor();
    const recovered = await volumeSlider(again);
    check(
      Number(await recovered.getAttribute('aria-valuenow')) === volume,
      `the recovered song has the last edit (volume ${String(volume)})`,
    );
    check((await again.title()).startsWith('● '), 'the recovered song opens as unsaved');

    // Closing the window with unsaved changes asks first; Don't save closes and clears the draft.
    // The window, not the process: closing the last window does not quit the app on macOS.
    // Attached before the window closes: on Windows closing the last window quits the app, and an
    // 'exit' that already happened is not replayed.
    const exit = exitCodeOf(relaunched.process());
    const closed = again.waitForEvent('close');
    await relaunched.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    const prompt = again.getByRole('dialog', { name: 'Unsaved changes' });
    await prompt.waitFor();
    check(true, 'closing the window asks about the unsaved changes');
    await prompt.getByRole('button', { name: 'Don’t save' }).click();
    await closed;
    check(
      (await draftNames(profileDir)).length === 0,
      "Don't save closed the window and removed the draft",
    );

    // macOS keeps the app alive with no window, so it is asked to quit; Windows is already quitting.
    await relaunched
      .evaluate(({ app }) => {
        app.quit();
      })
      .catch(() => undefined);
    const exitCode = await Promise.race([
      exit,
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => {
          resolve('timeout');
        }, TIMEOUT),
      ),
    ]);
    check(exitCode === 0, `the app quits cleanly (exit code ${String(exitCode)})`);
  } finally {
    await closeQuietly(running);
  }
}

const profileDir = await mkdtemp(join(tmpdir(), 'reprise-smoke-'));
try {
  await main(profileDir, {});
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  // Not exit(): that would skip the cleanup below.
  process.exitCode = 1;
} finally {
  // After app.close(), so Chromium no longer holds files open in it.
  // Windows can keep a child process's files open for a moment after close: retry, then warn.
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
    (error: unknown) => {
      console.warn(`could not remove ${profileDir}: ${String(error)}`);
    },
  );
}

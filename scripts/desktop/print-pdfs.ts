/**
 * Acceptance PDFs from the packaged desktop app: launches the unpacked build as `smoke.ts` does,
 * replaces `webContents.print` with a `printToPDF` of the same page, and prints three fixtures on
 * A4 and Letter through File → Print… and our Print dialog. Fails unless main passed the paper,
 * no background and no margins, and each PDF has the DOM's page count on the paper's MediaBox.
 *
 *   pnpm desktop:build && pnpm desktop:print-pdfs [executable]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process, { argv, exit } from 'node:process';

import { _electron as electron } from 'playwright';

// eslint-disable-next-line import-x/no-relative-packages -- the visual suite's PDF reader; the web package exports no tooling
import { pdfPages } from '../../apps/web/e2e/visual/test/pdf-pages.node.ts';

const ROOT = join(import.meta.dirname, '../..');
const RELEASE = join(ROOT, 'apps/desktop/release');
const OUT = join(RELEASE, 'print');
const TIMEOUT = 30_000;
const FIXTURES = ['gp5/effects.gp5', 'gp5/key-signatures.gp5', 'gp/drum-tabs.gp'];
const PAPERS = [
  { label: 'A4', pageSize: 'A4', points: [595.92, 841.92] },
  { label: 'Letter', pageSize: 'Letter', points: [612, 792] },
] as const;

interface Printed {
  options: unknown;
  domPages: number;
  pdf: string;
}

function packagedExecutable(): string {
  if (process.platform === 'darwin') {
    const dir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    return join(RELEASE, dir, 'Reprise.app/Contents/MacOS/Reprise');
  }
  if (process.platform === 'win32') return join(RELEASE, 'win-unpacked', 'Reprise.exe');
  throw new Error(`pnpm desktop:build makes no unpacked app on ${process.platform}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({
    executablePath: argv[2] ?? packagedExecutable(),
    timeout: TIMEOUT,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(TIMEOUT);
    await page.waitForLoadState('load');

    // The renderer's print path runs untouched up to webContents.print, which no script can
    // drive past the system dialog; this one prints the same page to PDF instead.
    await app.evaluate(({ BrowserWindow }) => {
      const printed: unknown[] = [];
      Object.assign(globalThis, { reprisePrinted: printed });
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents) throw new Error('no window');
      const prototype: unknown = Object.getPrototypeOf(contents);
      if (!isPrintable(prototype)) throw new Error('webContents has no print');
      prototype.print = function print(
        this: Electron.WebContents,
        options: Electron.WebContentsPrintOptions,
        callback?: (success: boolean, reason: string) => void,
      ) {
        void (async () => {
          const domPages: unknown = await this.executeJavaScript(
            "document.querySelectorAll('.score-print .score-page').length",
          );
          const pdf = await this.printToPDF({
            preferCSSPageSize: true,
            printBackground: false,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
          });
          printed.push({ options, domPages, pdf: pdf.toString('base64') });
          callback?.(true, '');
        })();
      };
      function isPrintable(value: unknown): value is { print: unknown } {
        return typeof value === 'object' && value !== null && 'print' in value;
      }
    });

    const rows: string[][] = [['fixture', 'paper', 'pages', 'MediaBox (pt)', 'bytes', 'file']];
    for (const fixture of FIXTURES) {
      const systems = page.getByRole('main', { name: 'Score' }).locator('[data-system-id]');
      const previous =
        (await systems.count()) > 0 ? await systems.first().getAttribute('data-system-id') : null;
      await app.evaluate(
        ({ dialog }, path) => {
          dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
        },
        join(ROOT, 'fixtures', fixture),
      );
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'file.open');
      });
      // System ids carry the file's master-bar ids, so a new first id is the next file painted.
      const first =
        "document.querySelector('main [data-system-id]')?.getAttribute('data-system-id')";
      await page.waitForFunction(`(${first} ?? null) !== ${JSON.stringify(previous)}`);

      for (const paper of PAPERS) {
        const before = await app.evaluate(() => {
          const printed: unknown = Reflect.get(globalThis, 'reprisePrinted');
          return Array.isArray(printed) ? printed.length : 0;
        });
        await app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'file.print');
        });
        const dialog = page.getByRole('dialog', { name: 'Print' });
        await dialog.getByRole('radio', { name: paper.label }).click();
        await dialog.getByRole('button', { name: 'Print…' }).click();
        const count = () =>
          app.evaluate(() => {
            const all: unknown = Reflect.get(globalThis, 'reprisePrinted');
            return Array.isArray(all) ? all.length : 0;
          });
        const deadline = Date.now() + TIMEOUT;
        while ((await count()) <= before) {
          if (Date.now() > deadline) throw new Error(`${fixture} on ${paper.label} never printed`);
          await page.waitForTimeout(100);
        }
        await page.locator('.score-print').waitFor({ state: 'detached' });
        const printed = await app.evaluate((_, index) => {
          const all: unknown = Reflect.get(globalThis, 'reprisePrinted');
          return Array.isArray(all) ? (all[index] as unknown) : undefined;
        }, before);
        if (!isRecord(printed) || typeof printed['pdf'] !== 'string') {
          throw new Error(`${fixture} on ${paper.label} printed nothing`);
        }
        const result: Printed = {
          options: printed['options'],
          domPages: Number(printed['domPages']),
          pdf: printed['pdf'],
        };
        const options = isRecord(result.options) ? result.options : {};
        const margins = isRecord(options['margins']) ? options['margins'] : {};
        check(
          options['printBackground'] === false,
          `printBackground is false (${JSON.stringify(options)})`,
        );
        check(margins['marginType'] === 'none', `marginType is none (${JSON.stringify(options)})`);
        check(
          options['pageSize'] === paper.pageSize,
          `pageSize is ${paper.pageSize} (${JSON.stringify(options)})`,
        );
        const bytes = Buffer.from(result.pdf, 'base64');
        const read = pdfPages(bytes);
        check(
          read.count === result.domPages && read.count > 0,
          `${fixture} on ${paper.label}: ${String(read.count)} PDF pages for ${String(result.domPages)} in the DOM`,
        );
        for (const [width, height] of read.mediaBoxes) {
          check(
            Math.abs(width - paper.points[0]) <= 0.01 && Math.abs(height - paper.points[1]) <= 0.01,
            `${fixture} on ${paper.label}: MediaBox ${String(width)} × ${String(height)}`,
          );
        }
        const stem = (fixture.split('/').pop() ?? fixture).replace(/\.\w+$/, '');
        const file = join(OUT, `${stem}-${paper.label.toLowerCase()}.pdf`);
        writeFileSync(file, bytes);
        const box = read.mediaBoxes[0] ?? [0, 0];
        rows.push([
          fixture,
          paper.label,
          String(read.count),
          `${String(box[0])} × ${String(box[1])}`,
          String(bytes.byteLength),
          file.slice(ROOT.length + 1),
        ]);
      }
    }
    console.log(rows.map((row) => `| ${row.join(' | ')} |`).join('\n'));
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

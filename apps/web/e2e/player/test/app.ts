import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { test as base, expect, type Locator, type Page } from '@playwright/test';

import {
  installPageHooks,
  type FollowWatch,
  type FrameWatch,
  type ReadoutField,
} from './page-hooks';

export { expect };

/** Decoding a song's GM presets, or one new instrument, takes about a second locally. */
export const SONG_READY_MS = 15_000;
const SETTLE_MS = 5000;

export interface Point {
  x: number;
  y: number;
}

export interface Box extends Point {
  width: number;
  height: number;
}

export const centre = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

const filesRoute = (name: string) => `**/__e2e__/files/${encodeURIComponent(name)}`;
const filesUrl = (name: string) => `/__e2e__/files/${encodeURIComponent(name)}`;

export class App {
  constructor(readonly page: Page) {}

  get playButton(): Locator {
    return this.page
      .getByRole('group', { name: 'Playback' })
      .getByRole('button', { name: /^(Play|Pause)$/ });
  }

  score(): Locator {
    return this.page.getByRole('region', { name: /^Score: / });
  }

  async description(): Promise<string> {
    const id = await this.score().getAttribute('aria-describedby');
    if (id === null) throw new Error('The score region has no description');
    return (await this.page.locator(`[id="${id}"]`).textContent()) ?? '';
  }

  field(name: ReadoutField): Locator {
    return this.page.locator(`[data-position-readout] [data-field="${name}"]`);
  }

  strip(n: number): Locator {
    return this.page
      .getByRole('complementary', { name: 'Panel' })
      .getByRole('group', { name: `Track ${String(n)}`, exact: true });
  }

  /** Serves `path` at a URL only this page sees, so a 25 MB file never crosses the CDP wire. */
  async serve(path: string, name = basename(path)): Promise<string> {
    await this.page.route(filesRoute(name), (route) => route.fulfill({ path }));
    return name;
  }

  async serveBytes(bytes: Uint8Array, name: string): Promise<string> {
    await this.page.route(filesRoute(name), (route) =>
      route.fulfill({ body: Buffer.from(bytes), contentType: 'application/octet-stream' }),
    );
    return name;
  }

  /** Writes the file into origin-private storage, where the stubbed pickers find it. */
  async stage(path: string, name = basename(path)): Promise<void> {
    await this.serve(path, name);
    await this.page.evaluate(
      async ({ url, file }) => {
        const bytes = await (await fetch(url)).arrayBuffer();
        const root = await navigator.storage.getDirectory();
        const writable = await (await root.getFileHandle(file, { create: true })).createWritable();
        await writable.write(bytes);
        await writable.close();
      },
      { url: filesUrl(name), file: name },
    );
  }

  async pick(name: string): Promise<void> {
    await this.page.evaluate((file) => window.__e2e.picks.push(file), name);
  }

  async openWithPicker(path: string, name = basename(path)): Promise<void> {
    await this.stage(path, name);
    await this.pick(name);
    await this.page.keyboard.press('ControlOrMeta+o');
    await this.waitReady(name);
  }

  async openFromPalette(path: string, name = basename(path)): Promise<void> {
    await this.stage(path, name);
    await this.pick(name);
    await this.palette('Open file');
    await this.waitReady(name);
  }

  async palette(text: string): Promise<void> {
    // The previous palette (or dialog) must be gone: Radix keeps a closing dialog mounted for its
    // exit animation, and Ctrl+K or Enter then lands on it instead of the new one.
    await expect(this.page.getByRole('dialog')).toHaveCount(0);
    await this.page.keyboard.press('ControlOrMeta+k');
    // Not by role: a dialog the command opens has comboboxes of its own.
    const input = this.page.locator('[cmdk-input]');
    await input.fill(text);
    await input.press('Enter');
    await expect(input).toHaveCount(0);
  }

  /** Types `text` into the palette and runs the selected row's alternate action (Cmd+Enter). */
  async paletteAlt(text: string): Promise<void> {
    await expect(this.page.getByRole('dialog')).toHaveCount(0);
    await this.page.keyboard.press('ControlOrMeta+k');
    const input = this.page.locator('[cmdk-input]');
    await input.fill(text);
    // The rows are in place once the first one is selected.
    await expect(this.page.locator('[cmdk-item][aria-selected="true"]')).toHaveCount(1);
    await input.press('ControlOrMeta+Enter');
    await expect(input).toHaveCount(0);
  }

  /** Builds the dropped `File` in the page before returning, so a timed drop is only the event. */
  async prepareDrop(name: string): Promise<void> {
    await this.page.evaluate(
      async ({ url, file }) => {
        const bytes = await (await fetch(url)).arrayBuffer();
        Object.assign(window, { __e2eDrop: new File([bytes], file) });
      },
      { url: filesUrl(name), file: name },
    );
  }

  async dispatchDrop(): Promise<void> {
    await this.page.evaluate(() => {
      const file: unknown = Reflect.get(window, '__e2eDrop');
      if (!(file instanceof File)) throw new Error('No file prepared to drop');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      window.dispatchEvent(
        new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }),
      );
    });
  }

  async drop(path: string, name = basename(path)): Promise<void> {
    await this.serve(path, name);
    await this.prepareDrop(name);
    await this.dispatchDrop();
  }

  async dropBytes(bytes: Uint8Array, name: string): Promise<void> {
    await this.serveBytes(bytes, name);
    await this.prepareDrop(name);
    await this.dispatchDrop();
  }

  /** The score is painted and the song's instruments are decoded, so Play works. */
  async waitReady(name?: string): Promise<void> {
    const region =
      name === undefined
        ? this.score()
        : this.page.getByRole('region', { name: `Score: ${name}`, exact: true });
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute('aria-busy', 'false');
    await expect(this.playButton).toBeEnabled({ timeout: SONG_READY_MS });
  }

  async level(): Promise<{ rms: number; peak: number; state: string }> {
    return this.page.evaluate(() => window.__e2e.level());
  }

  async expectSound(): Promise<void> {
    await expect.poll(async () => (await this.level()).rms).toBeGreaterThan(1e-3);
  }

  async expectSilence(): Promise<void> {
    await expect.poll(async () => (await this.level()).peak).toBeLessThan(1e-4);
  }

  /** A key press that is no shortcut: the user's first gesture, which builds the AudioContext. */
  async gesture(): Promise<void> {
    await this.page.keyboard.press('x');
    await expect.poll(() => this.contextState()).toBe('running');
  }

  async contextState(): Promise<string> {
    return this.page.evaluate(() => window.__e2e.contexts[0]?.state ?? 'none');
  }

  /** The state of every AudioContext the page has made, the player's first. */
  async contextStates(): Promise<string[]> {
    return this.page.evaluate(() => window.__e2e.contexts.map((context) => context.state));
  }

  async opens(): Promise<number> {
    return this.page.evaluate(() => window.__e2e.opens);
  }

  async contexts(): Promise<number> {
    return this.page.evaluate(() => window.__e2e.contexts.length);
  }

  peakWhile(field: ReadoutField, text: string): Promise<number> {
    return this.page.evaluate(([f, t]) => window.__e2e.peakWhile(f, t), [field, text] as const);
  }

  beatInterval(changes: number): Promise<number> {
    return this.page.evaluate((n) => window.__e2e.beatInterval(n), changes);
  }

  barTrail(from: string, to: string, times: number) {
    return this.page.evaluate(([f, t, n]) => window.__e2e.barTrail(f, t, n), [
      from,
      to,
      times,
    ] as const);
  }

  barsUntilStopped() {
    return this.page.evaluate(() => window.__e2e.barsUntilStopped());
  }

  watchFollow(untilBar: string): Promise<FollowWatch> {
    return this.page.evaluate((bar) => window.__e2e.watchFollow(bar), untilBar);
  }

  watchFrames(untilBar: string): Promise<FrameWatch> {
    return this.page.evaluate((bar) => window.__e2e.watchFrames(bar), untilBar);
  }

  async regionScroll(): Promise<{ rect: Box; left: number; top: number }> {
    return this.score().evaluate((region) => {
      const { x, y, width, height } = region.getBoundingClientRect();
      return { rect: { x, y, width, height }, left: region.scrollLeft, top: region.scrollTop };
    });
  }

  /** Waits until the score's own smooth scroll has landed: the region drops `data-scrolling`. */
  async settle(): Promise<void> {
    await expect(
      this.score(),
      `The score kept scrolling for ${String(SETTLE_MS)} ms`,
    ).not.toHaveAttribute('data-scrolling', { timeout: SETTLE_MS });
  }

  /** An element's box in the score's scroll-content coordinates, which a seek's scroll keeps. */
  async contentBox(selector: string): Promise<Box> {
    await this.settle();
    const box = await this.page.locator(selector).boundingBox();
    if (!box) throw new Error(`${selector} has no box`);
    const { rect, left, top } = await this.regionScroll();
    return {
      x: box.x - rect.x + left,
      y: box.y - rect.y + top,
      width: box.width,
      height: box.height,
    };
  }

  /** Moves the playhead to `bar` (first pass) and returns the bar highlight's content box. */
  async barBox(bar: number): Promise<Box> {
    await this.page.keyboard.press('ControlOrMeta+Home');
    for (let i = 1; i < bar; i += 1) await this.page.keyboard.press('ControlOrMeta+ArrowRight');
    await expect(this.field('bar')).toHaveText(new RegExp(`^${String(bar)}/`));
    return this.contentBox('[data-playhead] .score-bar-highlight');
  }

  /** Maps a content point to the viewport at the time of the call; it must be in view. */
  async toViewport(point: Point): Promise<Point> {
    await this.settle();
    const { rect, left, top } = await this.regionScroll();
    const x = rect.x + point.x - left;
    const y = rect.y + point.y - top;
    if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) {
      throw new Error(`Content point ${JSON.stringify(point)} is outside the visible score`);
    }
    return { x, y };
  }

  async clickContent(point: Point): Promise<void> {
    const { x, y } = await this.toViewport(point);
    await this.page.mouse.click(x, y);
  }

  async dragContent(from: Point, to: Point): Promise<void> {
    const start = await this.toViewport(from);
    const end = await this.toViewport(to);
    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move(end.x, end.y, { steps: 8 });
    await this.page.mouse.up();
  }

  async writeCount(name: string): Promise<number> {
    return this.page.evaluate(
      (file) => window.__e2e.writes.filter((write) => write.name === file).length,
      name,
    );
  }

  async waitForWrite(name: string, after: number): Promise<void> {
    await this.page.waitForFunction(
      ([file, count]) => window.__e2e.writes.filter((write) => write.name === file).length > count,
      [name, after] as const,
    );
  }

  async readStored(name: string): Promise<Uint8Array> {
    const bytes = await this.page.evaluate(async (file) => {
      const root = await navigator.storage.getDirectory();
      const data = await (await root.getFileHandle(file)).getFile();
      return [...new Uint8Array(await data.arrayBuffer())];
    }, name);
    return Uint8Array.from(bytes);
  }

  /** How many songs the library database holds; the row lands after the song's files do. */
  async songRows(): Promise<number> {
    return this.page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('reprise');
          open.onerror = () => {
            resolve(0);
          };
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('songs')) {
              db.close();
              resolve(0);
              return;
            }
            const count = db.transaction('songs').objectStore('songs').count();
            count.onsuccess = () => {
              db.close();
              resolve(count.result);
            };
            count.onerror = () => {
              db.close();
              resolve(0);
            };
          };
        }),
    );
  }

  /** The names in an origin-private folder (`library/songs`); empty when it does not exist yet. */
  async listStored(path: string): Promise<string[]> {
    return this.page.evaluate(async (folder) => {
      try {
        let dir = await navigator.storage.getDirectory();
        for (const name of folder.split('/')) dir = await dir.getDirectoryHandle(name);
        const names: string[] = [];
        for await (const key of dir.keys()) names.push(key);
        return names.sort();
      } catch {
        return [];
      }
    }, path);
  }

  /** A file under origin-private storage by its root-relative path (`library/songs/a.reprise`). */
  async readStoredPath(path: string): Promise<Uint8Array> {
    const bytes = await this.page.evaluate(async (file) => {
      const parts = file.split('/');
      const name = parts.pop() ?? '';
      let dir = await navigator.storage.getDirectory();
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      const data = await (await dir.getFileHandle(name)).getFile();
      return [...new Uint8Array(await data.arrayBuffer())];
    }, path);
    return Uint8Array.from(bytes);
  }

  async saves() {
    return this.page.evaluate(() => window.__e2e.saves);
  }
}

const policyViolations = new WeakMap<Page, string[]>();

/**
 * Chromium reports every Content-Security-Policy block as a console message, workers' and
 * fetches' included, which a page-side listener would miss. `vite preview` sends the shipped
 * policy, so any block is a real regression and the `app` fixture fails the test on one.
 */
function watchPolicyViolations(page: Page): void {
  const seen: string[] = [];
  policyViolations.set(page, seen);
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to /i.test(message.text())) seen.push(message.text());
  });
}

export async function installHooks(page: Page): Promise<void> {
  watchPolicyViolations(page);
  await page.addInitScript(installPageHooks);
}

const spares = new WeakMap<Page, Page>();

/**
 * Ends the page the way a renderer crash does: no `pagehide`, no `beforeunload`, nothing flushed. Another
 * page of the same context sees what the app had written to origin-private storage and the
 * library database by then.
 */
export async function crash(page: Page): Promise<void> {
  // A second page first: the context must outlive the page that crashes.
  spares.set(page, await page.context().newPage());
  const crashed = page.waitForEvent('crash');
  // The renderer's own crash page: Chromium's headless shell takes the whole browser down with a
  // CDP `Page.crash`, this takes the renderer only, with the same effect on the page.
  await page.goto('chrome://crash').catch(() => undefined);
  await crashed;
}

/** A new page in the same context, so storage survives, with the hooks installed. The crashed page is left to the context. */
export async function relaunch(page: Page): Promise<App> {
  const next = spares.get(page) ?? (await page.context().newPage());
  await installHooks(next);
  await next.goto('/');
  return new App(next);
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, provide) => {
    // A modified page asks before it unloads; a test that reloads one must not wait on the prompt.
    page.on('dialog', (dialog) => {
      void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
    });
    await installHooks(page);
    await page.goto('/');
    await provide(new App(page));
    expect(policyViolations.get(page) ?? [], 'Content-Security-Policy violations').toEqual([]);
  },
});

export const readBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

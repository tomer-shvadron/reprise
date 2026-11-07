import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { test as base, expect, type Locator, type Page } from '@playwright/test';

import { installPageHooks, type FollowWatch, type ReadoutField } from './page-hooks';

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
    await this.page.keyboard.press('ControlOrMeta+k');
    const input = this.page.getByRole('combobox');
    await input.fill(text);
    await input.press('Enter');
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

  watchFollow(untilBar: string): Promise<FollowWatch> {
    return this.page.evaluate((bar) => window.__e2e.watchFollow(bar), untilBar);
  }

  async regionScroll(): Promise<{ rect: Box; left: number; top: number }> {
    return this.score().evaluate((region) => {
      const { x, y, width, height } = region.getBoundingClientRect();
      return { rect: { x, y, width, height }, left: region.scrollLeft, top: region.scrollTop };
    });
  }

  /** Waits until the score's smooth scroll after a seek has stopped for a few frames. */
  async settle(): Promise<void> {
    const settled = await this.score().evaluate(
      (region, guard) =>
        new Promise<boolean>((resolve) => {
          let last = '';
          let still = 0;
          const start = performance.now();
          const frame = () => {
            const now = `${String(region.scrollLeft)},${String(region.scrollTop)}`;
            still = now === last ? still + 1 : 0;
            last = now;
            if (still >= 5) resolve(true);
            else if (performance.now() - start > guard) resolve(false);
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }),
      SETTLE_MS,
    );
    if (!settled) throw new Error(`The score kept scrolling for ${String(SETTLE_MS)} ms`);
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

  /**
   * Presses ⌘→ `times` times, each after the last seek's scroll has settled: a seek pressed
   * while the previous one's smooth scroll is in flight leaves the view behind, an app bug
   * recorded on #76 (https://github.com/tomer-shvadron/reprise/issues/76#issuecomment-6705653330)
   * and pinned by `seek.spec.ts`. Fixing it makes this a plain loop.
   */
  async nextBars(times: number): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      const time = (await this.field('time').textContent()) ?? '';
      await this.page.keyboard.press('ControlOrMeta+ArrowRight');
      await expect(this.field('time')).not.toHaveText(time);
      await this.settle();
    }
  }

  /** Maps a content point to the viewport at the time of the call; it must be in view. */
  async toViewport(point: Point): Promise<Point> {
    const map = async () => {
      await this.settle();
      const { rect, left, top } = await this.regionScroll();
      const x = rect.x + point.x - left;
      const y = rect.y + point.y - top;
      const inside =
        x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
      return { x, y, inside };
    };
    // A seek's follow scroll can start a few frames after the key, past a settled view.
    await expect
      .poll(async () => (await map()).inside, {
        message: `Content point ${JSON.stringify(point)} is outside the visible score`,
      })
      .toBe(true);
    const { x, y } = await map();
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

  async saves() {
    return this.page.evaluate(() => window.__e2e.saves);
  }
}

export async function installHooks(page: Page): Promise<void> {
  await page.addInitScript(installPageHooks);
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, provide) => {
    await installHooks(page);
    await page.goto('/');
    await provide(new App(page));
  },
});

export const readBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

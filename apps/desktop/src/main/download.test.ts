import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDownloadManager } from './download';
import type { HttpGet, HttpHop } from './download-http';
import type { StorageRoots } from './storage-fs';

let base: string;
let roots: StorageRoots;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'reprise-dl-'));
  roots = { library: join(base, 'library'), data: join(base, 'data') };
  mkdirSync(roots.library);
  mkdirSync(roots.data);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const payload = Uint8Array.from([1, 2, 3, 4, 5, 6]);
const sha = createHash('sha256').update(payload).digest('hex');

const okGet = (bytes: Uint8Array = payload): HttpGet => {
  return () =>
    Promise.resolve<HttpHop>({
      status: 200,
      contentLength: bytes.byteLength,
      close: () => undefined,
      body: (async function* () {
        await Promise.resolve();
        yield bytes.subarray(0, 3);
        yield bytes.subarray(3);
      })(),
    });
};

const job = (
  over: Partial<Parameters<ReturnType<typeof createDownloadManager>['start']>[0]> = {},
) => ({
  owner: 1,
  id: 'd1',
  url: 'https://example.com/pack.zip',
  to: 'data/sounds/pack.zip',
  sha256: sha,
  maxBytes: 1000,
  onProgress: () => undefined,
  ...over,
});

const soundsDir = () => join(roots.data, 'sounds');

describe('the download manager', () => {
  it('renames the part file into place when the hash matches, leaving nothing else', async () => {
    const manager = createDownloadManager({ roots, get: okGet() });

    await expect(manager.start(job())).resolves.toEqual({ size: 6 });

    expect(readFileSync(join(soundsDir(), 'pack.zip'))).toEqual(Buffer.from(payload));
    expect(readdirSync(soundsDir())).toEqual(['pack.zip']);
  });

  it('writes a hidden .part file while streaming, and removes it on a mismatch', async () => {
    let during: string[] = [];
    const get: HttpGet = () =>
      Promise.resolve<HttpHop>({
        status: 200,
        close: () => undefined,
        body: (async function* () {
          yield payload;
          // The consumer has written the chunk by the time it asks for the next one.
          await Promise.resolve();
          during = readdirSync(soundsDir());
        })(),
      });
    const manager = createDownloadManager({ roots, get });

    await expect(manager.start(job({ sha256: '0'.repeat(64) }))).rejects.toMatchObject({
      reason: 'hash-mismatch',
    });

    expect(during).toHaveLength(1);
    expect(during[0]).toMatch(/^\.pack\.zip\.[0-9a-f]{12}\.part$/);
    expect(readdirSync(soundsDir())).toEqual([]);
  });

  it('keeps an existing file when a download of it fails', async () => {
    mkdirSync(soundsDir(), { recursive: true });
    const manager = createDownloadManager({ roots, get: okGet() });
    await manager.start(job());

    await expect(manager.start(job({ sha256: '1'.repeat(64) }))).rejects.toThrow();

    expect(readdirSync(soundsDir())).toEqual(['pack.zip']);
  });

  it('cancels through the id, removing the part file', async () => {
    let release: () => void = () => undefined;
    const get: HttpGet = (_url, signal) =>
      Promise.resolve<HttpHop>({
        status: 200,
        close: () => undefined,
        body: (async function* () {
          yield payload.subarray(0, 2);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          if (signal.aborted) throw new Error('aborted');
          yield payload.subarray(2);
        })(),
      });
    const manager = createDownloadManager({ roots, get });

    const pending = manager.start(job());
    await new Promise((r) => setTimeout(r, 20));
    manager.cancel(1, 'd1');
    release();

    await expect(pending).rejects.toMatchObject({ reason: 'cancelled' });
    expect(readdirSync(soundsDir())).toEqual([]);
  });

  /** A `get` that answers each request only when the test calls the matching release. */
  function gated() {
    const releases: (() => void)[] = [];
    const get: HttpGet = () =>
      new Promise((resolve) => {
        releases.push(() => {
          resolve({ status: 200, close: () => undefined, body: okBody() });
        });
      });
    const releaseAll = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const release of releases) release();
    };
    return { get, releaseAll };
  }

  it('refuses an id already in use, and lets the same manager reuse it afterwards', async () => {
    const { get, releaseAll } = gated();
    const manager = createDownloadManager({ roots, get });

    const first = manager.start(job());
    await expect(manager.start(job())).rejects.toThrow(/already running/);
    await releaseAll();
    await first;

    const again = manager.start(job());
    await releaseAll();
    await expect(again).resolves.toEqual({ size: 6 });
  });

  it('allows four downloads at once and refuses a fifth until one ends', async () => {
    const { get, releaseAll } = gated();
    const manager = createDownloadManager({ roots, get });

    const running = ['a', 'b', 'c', 'd'].map((id) =>
      manager.start(job({ id, to: `data/sounds/${id}.zip` })),
    );
    await expect(manager.start(job({ id: 'e', to: 'data/sounds/e.zip' }))).rejects.toThrow(
      /Too many downloads/,
    );
    await releaseAll();
    await Promise.all(running);

    const fifth = manager.start(job({ id: 'e', to: 'data/sounds/e.zip' }));
    await releaseAll();
    await expect(fifth).resolves.toEqual({ size: 6 });
  });

  it('scopes ids to the window: another window can neither collide with nor cancel one', async () => {
    const { get, releaseAll } = gated();
    const manager = createDownloadManager({ roots, get });

    const mine = manager.start(job({ owner: 1 }));
    const theirs = manager.start(job({ owner: 2, to: 'data/sounds/other.zip' }));
    manager.cancel(2, 'nope');
    manager.cancel(3, 'd1');
    await releaseAll();

    await expect(mine).resolves.toEqual({ size: 6 });
    await expect(theirs).resolves.toEqual({ size: 6 });
  });

  it('cancels only the owner’s download of that id', async () => {
    const { get, releaseAll } = gated();
    const manager = createDownloadManager({ roots, get });

    const mine = manager.start(job({ owner: 1 }));
    const theirs = manager.start(job({ owner: 2, to: 'data/sounds/other.zip' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    manager.cancel(2, 'd1');
    await releaseAll();

    await expect(theirs).rejects.toMatchObject({ reason: 'cancelled' });
    await expect(mine).resolves.toEqual({ size: 6 });
  });

  it('ends a download whose body stalls as a timeout and deletes the part file', async () => {
    const get: HttpGet = () =>
      Promise.resolve<HttpHop>({
        status: 200,
        close: () => undefined,
        body: (async function* () {
          yield payload.subarray(0, 2);
          await new Promise(() => undefined);
        })(),
      });
    const manager = createDownloadManager({ roots, get, idleTimeoutMs: 40 });

    await expect(manager.start(job())).rejects.toMatchObject({ reason: 'timeout' });

    expect(readdirSync(soundsDir())).toEqual([]);
  });

  it('ends a request that never answers as a timeout', async () => {
    const get: HttpGet = (_url, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const manager = createDownloadManager({ roots, get, idleTimeoutMs: 40 });

    await expect(manager.start(job())).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('aborts the request signal when the download ends, so the response closes', async () => {
    let seen: AbortSignal | undefined;
    const get: HttpGet = (_url, signal) => {
      seen = signal;
      return okGet()(_url, signal);
    };
    const manager = createDownloadManager({ roots, get });

    await manager.start(job({ sha256: '0'.repeat(64) })).catch(() => undefined);

    expect(seen?.aborted).toBe(true);
  });

  it('refuses a Content-Length over maxBytes and writes no file', async () => {
    const manager = createDownloadManager({ roots, get: okGet() });

    await expect(manager.start(job({ maxBytes: 4 }))).rejects.toMatchObject({
      reason: 'too-large',
    });

    expect(existsSync(join(soundsDir(), 'pack.zip'))).toBe(false);
    expect(readdirSync(soundsDir())).toEqual([]);
  });

  it('refuses a redirect to http', async () => {
    const get: HttpGet = () =>
      Promise.resolve({
        status: 302,
        location: 'http://example.com/pack.zip',
        close: () => undefined,
        body: okBody(),
      });
    const manager = createDownloadManager({ roots, get });

    await expect(manager.start(job())).rejects.toThrow(/Refused a redirect/);
    expect(existsSync(soundsDir())).toBe(false);
  });

  it.each([['data/sounds/../x.zip'], ['library/a.zip'], ['data/other/a.zip'], ['data/sounds-x/a']])(
    'refuses the target %s before any request',
    async (to) => {
      const get = vi.fn(okGet());
      const manager = createDownloadManager({ roots, get });

      await expect(manager.start(job({ to }))).rejects.toThrow();

      expect(get).not.toHaveBeenCalled();
    },
  );
});

async function* okBody() {
  await Promise.resolve();
  yield payload;
}

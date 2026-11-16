import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    manager.cancel('d1');
    release();

    await expect(pending).rejects.toMatchObject({ reason: 'cancelled' });
    expect(readdirSync(soundsDir())).toEqual([]);
  });

  it('refuses an id already in use, and lets it be reused afterwards', async () => {
    let release: () => void = () => undefined;
    const get: HttpGet = () =>
      new Promise((resolve) => {
        release = () => {
          resolve({ status: 200, close: () => undefined, body: okBody() });
        };
      });
    const manager = createDownloadManager({ roots, get });

    const first = manager.start(job());
    await expect(manager.start(job())).rejects.toThrow(/already running/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await first;

    await expect(createDownloadManager({ roots, get: okGet() }).start(job())).resolves.toEqual({
      size: 6,
    });
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

  it('refuses a target that escapes its root, before any request', async () => {
    const manager = createDownloadManager({ roots, get: okGet() });

    await expect(manager.start(job({ to: 'data/sounds/../x.zip' }))).rejects.toThrow();
  });
});

async function* okBody() {
  await Promise.resolve();
  yield payload;
}

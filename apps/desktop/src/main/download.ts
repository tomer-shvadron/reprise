import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { openDownload, type HttpGet } from './download-http';
import {
  DownloadError,
  runDownload,
  type DownloadSink,
  type DownloadSource,
} from './download-machine';
import {
  realWriteOps,
  renameWithRetry,
  resolveStoragePath,
  TEMP_BASENAME_MAX,
  type StorageRoots,
  type WriteOps,
} from './storage-fs';

const DOWNLOAD_DIR = 'data/sounds/';

/** More would only compete for one connection; the Sounds screen runs one at a time. */
export const MAX_ACTIVE_DOWNLOADS = 4;

/**
 * The sink for `target`: a hidden `.<name>.<12 hex>.part` beside it, fsynced and renamed over
 * the target on commit, removed on discard. The startup sweep removes a `.part` a crash left.
 */
export async function createFileSink(
  target: string,
  ops: WriteOps = realWriteOps,
): Promise<DownloadSink> {
  await mkdir(dirname(target), { recursive: true });
  const name = basename(target).slice(0, TEMP_BASENAME_MAX);
  const part = join(dirname(target), `.${name}.${randomBytes(6).toString('hex')}.part`);
  const file = await ops.open(part, 'wx');
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await file.close();
  };
  return {
    write: async (chunk) => {
      await file.write(chunk);
    },
    commit: async () => {
      await file.sync();
      await close();
      await renameWithRetry(ops, part, target);
    },
    discard: async () => {
      await close().catch(() => undefined);
      await ops.rm(part, { force: true }).catch(() => undefined);
    },
  };
}

export interface DownloadJob {
  /** The window (webContents id) that asked; ids are scoped to it. */
  owner: number;
  id: string;
  url: string;
  /** A validated storage path under `data/sounds/`. */
  to: string;
  sha256: string;
  maxBytes: number;
  onProgress: (loaded: number, total?: number) => void;
}

export interface DownloadDeps {
  roots: StorageRoots;
  get: HttpGet;
  makeSink?: (target: string) => Promise<DownloadSink>;
  /** How long a download may wait for the response or for its next bytes; 30 s by default. */
  idleTimeoutMs?: number;
}

/** The downloads in flight, one per (owner, id): a window can only cancel its own. */
export function createDownloadManager({
  roots,
  get,
  makeSink = createFileSink,
  idleTimeoutMs = 30_000,
}: DownloadDeps) {
  const active = new Map<string, AbortController>();
  const keyOf = (owner: number, id: string) => `${String(owner)}:${id}`;

  return {
    async start(job: DownloadJob): Promise<{ size: number }> {
      // `validate.ts` checks this too; the manager does not rely on its caller for the one
      // place a download may write.
      if (!job.to.startsWith(DOWNLOAD_DIR)) {
        throw new Error(`A download goes to a file under ${DOWNLOAD_DIR}`);
      }
      const key = keyOf(job.owner, job.id);
      if (active.has(key)) throw new Error(`Download ${job.id} is already running`);
      if (active.size >= MAX_ACTIVE_DOWNLOADS) throw new Error('Too many downloads at once');
      const controller = new AbortController();
      // Registered before any await, so a cancel that arrives while the request opens finds it.
      active.set(key, controller);
      const state = { stalled: false };
      let openTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        state.stalled = true;
        controller.abort();
      }, idleTimeoutMs);
      try {
        const target = await resolveStoragePath(roots, job.to);
        // Content-Length, and so `total` and the progress ratio, count the bytes on the wire:
        // Chromium decodes gzip transparently, so `maxBytes` and the hash apply to decoded bytes.
        const source: DownloadSource = await openDownload(job.url, get, controller.signal);
        clearTimeout(openTimer);
        openTimer = undefined;
        const sink = await makeSink(target);
        return await runDownload({
          source,
          sink,
          sha256: job.sha256,
          maxBytes: job.maxBytes,
          signal: controller.signal,
          onProgress: job.onProgress,
          idleTimeoutMs,
        });
      } catch (error) {
        // A cancel can surface as a stream error from the aborted request; report it as one.
        if (state.stalled && !(error instanceof DownloadError)) {
          throw new DownloadError('timeout', 'The server did not answer in time');
        }
        if (controller.signal.aborted && !(error instanceof DownloadError)) {
          throw new DownloadError('cancelled', 'The download was cancelled');
        }
        throw error;
      } finally {
        clearTimeout(openTimer);
        active.delete(key);
        // Closes the response however the run ended: an early exit never drains the body.
        controller.abort();
      }
    },

    cancel(owner: number, id: string): void {
      active.get(keyOf(owner, id))?.abort();
    },
  };
}

export type DownloadManager = ReturnType<typeof createDownloadManager>;

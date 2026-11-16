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
}

/** The downloads in flight, one per id. */
export function createDownloadManager({ roots, get, makeSink = createFileSink }: DownloadDeps) {
  const active = new Map<string, AbortController>();

  return {
    async start(job: DownloadJob): Promise<{ size: number }> {
      if (active.has(job.id)) throw new Error(`Download ${job.id} is already running`);
      if (active.size >= MAX_ACTIVE_DOWNLOADS) throw new Error('Too many downloads at once');
      const controller = new AbortController();
      // Registered before any await, so a cancel that arrives while the request opens finds it.
      active.set(job.id, controller);
      try {
        const target = await resolveStoragePath(roots, job.to);
        const source: DownloadSource = await openDownload(job.url, get, controller.signal);
        const sink = await makeSink(target);
        return await runDownload({
          source,
          sink,
          sha256: job.sha256,
          maxBytes: job.maxBytes,
          signal: controller.signal,
          onProgress: job.onProgress,
        });
      } catch (error) {
        // A cancel can surface as a stream error from the aborted request; report it as one.
        if (controller.signal.aborted && !(error instanceof DownloadError)) {
          throw new DownloadError('cancelled', 'The download was cancelled');
        }
        throw error;
      } finally {
        active.delete(job.id);
      }
    },

    cancel(id: string): void {
      active.get(id)?.abort();
    },
  };
}

export type DownloadManager = ReturnType<typeof createDownloadManager>;

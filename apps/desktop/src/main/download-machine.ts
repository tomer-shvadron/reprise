import { createHash } from 'node:crypto';

/** Why a download ended without a file; `message` is what the renderer's promise rejects with. */
export type DownloadFailure = 'cancelled' | 'too-large' | 'hash-mismatch';

export class DownloadError extends Error {
  readonly reason: DownloadFailure;
  constructor(reason: DownloadFailure, message: string) {
    super(message);
    this.name = 'DownloadError';
    this.reason = reason;
  }
}

/** Where the bytes go: a hidden partial file that is either renamed into place or deleted. */
export interface DownloadSink {
  write(chunk: Uint8Array): Promise<void>;
  /** Makes the file final, atomically. Called only after the hash matched. */
  commit(): Promise<void>;
  /** Removes whatever was written. Called on every path that does not commit; must not throw. */
  discard(): Promise<void>;
}

export interface DownloadSource {
  /** The Content-Length, when the server sent one. */
  total?: number;
  body: AsyncIterable<Uint8Array>;
}

export interface RunDownload {
  source: DownloadSource;
  sink: DownloadSink;
  /** Lower-case hex. */
  sha256: string;
  maxBytes: number;
  signal: AbortSignal;
  onProgress: (loaded: number, total?: number) => void;
  /** Progress is passed on at most this often, plus once at the end. */
  progressIntervalMs?: number;
  now?: () => number;
}

const cancelled = () => new DownloadError('cancelled', 'The download was cancelled');

/**
 * Streams a body into a sink, hashing as it goes: the file is committed only when the SHA-256
 * matches, and the sink is discarded on a mismatch, a cancel, an oversize body or any error from
 * the stream or the sink. Pure of fs and network, so every ending is tested with a fake stream.
 */
export async function runDownload({
  source,
  sink,
  sha256,
  maxBytes,
  signal,
  onProgress,
  progressIntervalMs = 100,
  now = Date.now,
}: RunDownload): Promise<{ size: number }> {
  // A function, not `signal.aborted` inline: the flag changes across awaits, which control-flow
  // analysis cannot see.
  const isAborted = () => signal.aborted;
  try {
    if (isAborted()) throw cancelled();
    if (source.total !== undefined && source.total > maxBytes) {
      throw new DownloadError(
        'too-large',
        `The file is ${String(source.total)} bytes, over the limit of ${String(maxBytes)}`,
      );
    }
    const hash = createHash('sha256');
    let loaded = 0;
    let lastReport = Number.NEGATIVE_INFINITY;
    for await (const chunk of source.body) {
      if (isAborted()) throw cancelled();
      loaded += chunk.byteLength;
      if (loaded > maxBytes) {
        throw new DownloadError(
          'too-large',
          `The download passed the limit of ${String(maxBytes)}`,
        );
      }
      hash.update(chunk);
      await sink.write(chunk);
      const time = now();
      if (time - lastReport >= progressIntervalMs) {
        lastReport = time;
        onProgress(loaded, source.total);
      }
    }
    if (isAborted()) throw cancelled();
    if (hash.digest('hex') !== sha256) {
      throw new DownloadError('hash-mismatch', 'The download does not match its SHA-256');
    }
    await sink.commit();
    onProgress(loaded, source.total);
    return { size: loaded };
  } catch (error) {
    await sink.discard();
    throw error;
  }
}

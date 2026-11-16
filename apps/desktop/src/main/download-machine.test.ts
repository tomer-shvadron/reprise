import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  DownloadError,
  runDownload,
  type DownloadSink,
  type DownloadSource,
} from './download-machine';

const sha = (...chunks: Uint8Array[]) => {
  const hash = createHash('sha256');
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest('hex');
};

const chunk = (...values: number[]) => Uint8Array.from(values);

function fakeSink() {
  const events: string[] = [];
  const sink: DownloadSink = {
    write: (c) => {
      events.push(`write:${String(c.byteLength)}`);
      return Promise.resolve();
    },
    commit: () => {
      events.push('commit');
      return Promise.resolve();
    },
    discard: () => {
      events.push('discard');
      return Promise.resolve();
    },
  };
  return { sink, events };
}

async function* from(chunks: Uint8Array[], then?: () => void | never): AsyncGenerator<Uint8Array> {
  for (const c of chunks) {
    await Promise.resolve();
    yield c;
  }
  then?.();
}

const source = (body: AsyncIterable<Uint8Array>, total?: number): DownloadSource =>
  total === undefined ? { body } : { body, total };

const run = (
  overrides: Partial<Parameters<typeof runDownload>[0]> & { source: DownloadSource },
  sink: DownloadSink,
) =>
  runDownload({
    sink,
    sha256: '0'.repeat(64),
    maxBytes: 1000,
    signal: new AbortController().signal,
    onProgress: () => undefined,
    ...overrides,
  });

describe('runDownload', () => {
  const a = chunk(1, 2, 3);
  const b = chunk(4, 5);

  it('commits when the SHA-256 of the streamed bytes matches', async () => {
    const { sink, events } = fakeSink();

    await expect(run({ source: source(from([a, b])), sha256: sha(a, b) }, sink)).resolves.toEqual({
      size: 5,
    });

    expect(events).toEqual(['write:3', 'write:2', 'commit']);
  });

  it('discards on a hash mismatch and rejects', async () => {
    const { sink, events } = fakeSink();

    await expect(run({ source: source(from([a, b])), sha256: sha(a) }, sink)).rejects.toMatchObject(
      {
        reason: 'hash-mismatch',
      },
    );

    expect(events).toEqual(['write:3', 'write:2', 'discard']);
  });

  it('discards when the signal aborts mid-stream, without committing', async () => {
    const { sink, events } = fakeSink();
    const controller = new AbortController();
    const body = from([a, b], () => undefined);
    const wrapped = (async function* () {
      for await (const c of body) {
        yield c;
        controller.abort();
      }
    })();

    await expect(
      run({ source: source(wrapped), sha256: sha(a, b), signal: controller.signal }, sink),
    ).rejects.toMatchObject({ reason: 'cancelled' });

    expect(events).toEqual(['write:3', 'discard']);
  });

  it('refuses at once when the signal is already aborted', async () => {
    const { sink, events } = fakeSink();
    const controller = new AbortController();
    controller.abort();

    await expect(
      run({ source: source(from([a])), signal: controller.signal }, sink),
    ).rejects.toMatchObject({ reason: 'cancelled' });

    expect(events).toEqual(['discard']);
  });

  it('discards when the stream errors', async () => {
    const { sink, events } = fakeSink();
    const body = from([a], () => {
      throw new Error('connection reset');
    });

    await expect(run({ source: source(body), sha256: sha(a) }, sink)).rejects.toThrow(
      'connection reset',
    );

    expect(events).toEqual(['write:3', 'discard']);
  });

  it('discards when the sink fails to write', async () => {
    const { sink, events } = fakeSink();
    const failing: DownloadSink = { ...sink, write: () => Promise.reject(new Error('ENOSPC')) };

    await expect(run({ source: source(from([a])) }, failing)).rejects.toThrow('ENOSPC');

    expect(events).toEqual(['discard']);
  });

  it('refuses a Content-Length over the cap before reading a byte', async () => {
    const { sink, events } = fakeSink();
    const body = vi.fn(() => from([a]));

    await expect(
      run(
        { source: { total: 5000, body: { [Symbol.asyncIterator]: body } }, maxBytes: 1000 },
        sink,
      ),
    ).rejects.toMatchObject({ reason: 'too-large' });

    expect(body).not.toHaveBeenCalled();
    expect(events).toEqual(['discard']);
  });

  it('stops a body that outgrows maxBytes whatever Content-Length said', async () => {
    const { sink, events } = fakeSink();

    await expect(
      run({ source: source(from([a, b]), 3), maxBytes: 4, sha256: sha(a, b) }, sink),
    ).rejects.toBeInstanceOf(DownloadError);

    expect(events).toEqual(['write:3', 'discard']);
  });

  it('throttles progress and always reports the end', async () => {
    const { sink } = fakeSink();
    const onProgress = vi.fn();
    let time = 0;
    const now = () => time;
    const body = (async function* () {
      await Promise.resolve();
      for (const c of [a, a, a, a]) {
        yield c;
        time += 30;
      }
    })();

    await run(
      {
        source: source(body, 12),
        sha256: sha(a, a, a, a),
        onProgress,
        progressIntervalMs: 100,
        now,
      },
      sink,
    );

    // t=0 reports; t=30, 60, 90 are inside the interval; the end reports once more.
    expect(onProgress.mock.calls).toEqual([
      [3, 12],
      [12, 12],
    ]);
  });

  it('fails as a timeout when no chunk arrives within the idle limit, and discards', async () => {
    const { sink, events } = fakeSink();
    let released = false;
    const body = (async function* () {
      yield a;
      try {
        await new Promise(() => undefined);
      } finally {
        released = true;
      }
    })();

    await expect(
      run({ source: source(body), sha256: sha(a), idleTimeoutMs: 30 }, sink),
    ).rejects.toMatchObject({ reason: 'timeout' });

    expect(events).toEqual(['write:3', 'discard']);
    expect(released).toBe(false);
  });

  it('does not time out while chunks keep arriving', async () => {
    const { sink } = fakeSink();
    const body = (async function* () {
      for (const c of [a, b]) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield c;
      }
    })();

    await expect(
      run({ source: source(body), sha256: sha(a, b), idleTimeoutMs: 60 }, sink),
    ).resolves.toEqual({ size: 5 });
  });
});

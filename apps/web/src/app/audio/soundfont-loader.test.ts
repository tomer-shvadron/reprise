import { describe, expect, it, vi } from 'vitest';

import { fetchSoundfont, SoundfontError } from './soundfont-loader';

const MB = 1024 * 1024;

function riff(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0x52, 0x49, 0x46, 0x46]);
  for (let i = 4; i < length; i++) bytes[i] = i % 251;
  return bytes;
}

function streamed(bytes: Uint8Array, chunk: number, headers: HeadersInit = {}): typeof fetch {
  return vi.fn(() => {
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(at, at + chunk));
        at += chunk;
      },
    });
    return Promise.resolve(new Response(body, { status: 200, headers }));
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof SoundfontError ? error.code : 'other';
  }
  return undefined;
}

describe('fetchSoundfont', () => {
  it('streams the bank intact, reporting each whole percent up to the total', async () => {
    const bytes = riff(64 * 1024);
    const progress: [number, number | undefined][] = [];

    const loaded = await fetchSoundfont(
      'sf2',
      (done, total) => progress.push([done, total]),
      streamed(bytes, 256, { 'Content-Length': String(bytes.length) }),
    );

    expect(loaded).toEqual(bytes);
    expect(progress.length).toBeLessThanOrEqual(101);
    expect(progress.every(([, total]) => total === bytes.length)).toBe(true);
    expect(progress.map(([done]) => done)).toEqual(
      [...progress.map(([done]) => done)].sort((a, b) => a - b),
    );
    expect(progress.at(-1)?.[0]).toBe(bytes.length);
  });

  it('reports once a MiB without a Content-Length', async () => {
    const progress: number[] = [];
    await fetchSoundfont('sf2', (done) => progress.push(done), streamed(riff(3 * MB), 64 * 1024));
    expect(progress.length).toBeLessThanOrEqual(4);
  });

  it('calls a 404 and an HTML fallback missing, and a failed fetch a network error', async () => {
    const html = new TextEncoder().encode('<!doctype html><html></html>');
    expect(
      await codeOf(
        fetchSoundfont(
          'sf2',
          () => undefined,
          () => Promise.resolve(new Response(null, { status: 404 })),
        ),
      ),
    ).toBe('missing');
    expect(await codeOf(fetchSoundfont('sf2', () => undefined, streamed(html, 16)))).toBe(
      'missing',
    );
    expect(
      await codeOf(
        fetchSoundfont(
          'sf2',
          () => undefined,
          () => Promise.resolve(new Response(null, { status: 500 })),
        ),
      ),
    ).toBe('network');
    expect(
      await codeOf(
        fetchSoundfont(
          'sf2',
          () => undefined,
          () => Promise.reject(new TypeError('offline')),
        ),
      ),
    ).toBe('network');
  });

  it('tells the user how to fetch a missing bank', async () => {
    await expect(
      fetchSoundfont(
        'sf2',
        () => undefined,
        () => Promise.resolve(new Response(null, { status: 404 })),
      ),
    ).rejects.toThrow('Run pnpm sounds:fetch');
  });
});

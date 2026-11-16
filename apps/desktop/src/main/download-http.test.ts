import { describe, expect, it, vi } from 'vitest';

import { openDownload, type HttpGet, type HttpHop } from './download-http';

async function* body(...chunks: number[][]) {
  await Promise.resolve();
  for (const c of chunks) yield Uint8Array.from(c);
}

const hop = (over: Partial<HttpHop>, close: () => void = () => undefined): HttpHop => ({
  status: 200,
  body: body([1]),
  close,
  ...over,
});

const signal = new AbortController().signal;

/** Answers each request from the list, in order, and records the URLs asked. */
function script(...hops: HttpHop[]) {
  const urls: string[] = [];
  const get: HttpGet = (url) => {
    urls.push(url);
    const next = hops.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error('no more answers'));
  };
  return { get, urls };
}

describe('openDownload', () => {
  it('returns the body and the Content-Length of a 200', async () => {
    const { get } = script(hop({ contentLength: 7 }));

    const source = await openDownload('https://example.com/a', get, signal);

    expect(source.total).toBe(7);
  });

  it('follows https redirects, resolving a relative Location', async () => {
    const { get, urls } = script(
      hop({ status: 302, location: 'https://cdn.example.com/b' }),
      hop({ status: 301, location: '/c' }),
      hop({}),
    );

    await openDownload('https://example.com/a', get, signal);

    expect(urls).toEqual([
      'https://example.com/a',
      'https://cdn.example.com/b',
      'https://cdn.example.com/c',
    ]);
  });

  it('refuses a redirect to http and closes the redirect', async () => {
    const close = vi.fn();
    const redirect = hop({ status: 302, location: 'http://evil.example.com/a' }, close);
    const { get, urls } = script(redirect, hop({}));

    await expect(openDownload('https://example.com/a', get, signal)).rejects.toThrow(
      /Refused a redirect/,
    );

    expect(urls).toEqual(['https://example.com/a']);
    expect(close).toHaveBeenCalled();
  });

  it.each([['file:///etc/passwd'], ['https://user:pw@example.com/a'], ['ftp://example.com/a']])(
    'refuses a redirect to %s',
    async (location) => {
      const { get } = script(hop({ status: 307, location }));

      await expect(openDownload('https://example.com/a', get, signal)).rejects.toThrow(
        /Refused a redirect/,
      );
    },
  );

  it('stops after the redirect limit', async () => {
    const loop: HttpGet = () =>
      Promise.resolve(hop({ status: 302, location: 'https://example.com/a' }));

    await expect(openDownload('https://example.com/a', loop, signal, 3)).rejects.toThrow(
      /Too many redirects/,
    );
  });

  it('refuses a redirect with no Location', async () => {
    const { get } = script(hop({ status: 302 }));

    await expect(openDownload('https://example.com/a', get, signal)).rejects.toThrow(/Location/);
  });

  it('refuses a status that is neither a redirect nor 200, closing the answer', async () => {
    const close = vi.fn();
    const notFound = hop({ status: 404 }, close);
    const { get } = script(notFound);

    await expect(openDownload('https://example.com/a', get, signal)).rejects.toThrow(/404/);

    expect(close).toHaveBeenCalled();
  });
});

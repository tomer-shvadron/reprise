import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contentTypeOf, createAppProtocolHandler, resolveAppPath } from './app-protocol';
import { PathAccess } from './path-access';

describe('the app protocol', () => {
  let base: string;
  let root: string;
  let handle: (request: Request) => Promise<Response>;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'reprise-protocol-'));
    root = join(base, 'renderer');
    mkdirSync(join(root, 'assets'), { recursive: true });
    mkdirSync(join(root, 'sounds/gm'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!doctype html><p>Reprise</p>');
    writeFileSync(join(root, 'assets/index-abc.js'), 'console.log(1);');
    writeFileSync(join(root, 'sounds/gm/GeneralUser-GS.sf2'), 'RIFF');
    writeFileSync(join(base, 'secret.txt'), 'secret');
    symlinkSync(join(base, 'secret.txt'), join(root, 'link.txt'));
    handle = createAppProtocolHandler(root);
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const get = (url: string) => handle(new Request(url));

  it('serves index.html at the root, ignoring query and fragment', async () => {
    for (const url of ['reprise://app', 'reprise://app/', 'reprise://app/index.html?x=1#y']) {
      const response = await get(url);
      expect(response.status, url).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await response.text()).toBe('<!doctype html><p>Reprise</p>');
    }
  });

  it('serves the bank and scripts with their length and type', async () => {
    const bank = await get('reprise://app/sounds/gm/GeneralUser-GS.sf2');
    expect(bank.status).toBe(200);
    expect(bank.headers.get('content-length')).toBe('4');
    expect(bank.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await bank.arrayBuffer())).toEqual(new TextEncoder().encode('RIFF'));

    const script = await get('reprise://app/assets/index-abc.js');
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });

  // secret.txt exists, so without the guard the encoded escapes would answer 200.
  it.each([
    'reprise://app/..%2Fsecret.txt',
    'reprise://app/assets/..%2F..%2Fsecret.txt',
    'reprise://app/%2e%2e/secret.txt',
    'reprise://app/..%5Csecret.txt',
    'reprise://app/link.txt',
    'reprise://app/index.html%00.js',
    'reprise://app/%E0%A4%A',
    'reprise://app/assets',
    'reprise://app/assets/',
    'reprise://app/missing.js',
    'reprise://other/index.html',
  ])('answers 404 for %s', async (url) => {
    expect((await get(url)).status).toBe(404);
  });

  it('answers 404 to a 1 MB path without walking it', async () => {
    const started = performance.now();
    const response = await get(`reprise://app/${'a/'.repeat(500_000)}index.html`);
    expect(response.status).toBe(404);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('refuses an over-long decoded path even when the URL is short enough', () => {
    const access = new PathAccess([root]);
    expect(resolveAppPath(`reprise://app/${'a/'.repeat(600)}x`, root, access)).toBeUndefined();
  });

  it('answers 405 to anything but GET', async () => {
    const response = await handle(new Request('reprise://app/index.html', { method: 'POST' }));
    expect(response.status).toBe(405);
  });

  it('resolves only paths inside the root', () => {
    const access = new PathAccess([root]);
    expect(resolveAppPath('reprise://app/sounds/gm/GeneralUser-GS.sf2', root, access)).toBe(
      join(root, 'sounds/gm/GeneralUser-GS.sf2'),
    );
    expect(resolveAppPath('reprise://app/..%2Fsecret.txt', root, access)).toBeUndefined();
  });
});

describe('contentTypeOf', () => {
  it('falls back to octet-stream and ignores case', () => {
    expect(contentTypeOf('a/b.sf2')).toBe('application/octet-stream');
    expect(contentTypeOf('a/B.WOFF2')).toBe('font/woff2');
  });
});

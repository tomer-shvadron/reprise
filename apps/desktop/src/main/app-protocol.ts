import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { PathAccess } from './path-access';

export const APP_SCHEME = 'reprise';
export const APP_HOST = 'app';
export const APP_INDEX_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** The file under `root` an app URL names, or undefined when it names nothing there. */
export function resolveAppPath(url: string, root: string, access: PathAccess): string | undefined {
  const { protocol, host, pathname } = new URL(url);
  if (protocol !== `${APP_SCHEME}:` || host !== APP_HOST) return undefined;
  let path: string;
  try {
    // Chromium hands `%2F` over still encoded, so the decoded path is what the guard must stop.
    path = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (path.includes('\0')) return undefined;
  const target = resolve(root, `.${path === '' || path === '/' ? '/index.html' : path}`);
  return access.allows(target) ? target : undefined;
}

const notFound = () => new Response('Not found', { status: 404 });

/**
 * Serves the built renderer. A path outside `root` answers 404 like a missing one. Range is
 * ignored: nothing in the renderer asks for one, so every GET gets the whole file.
 */
export function createAppProtocolHandler(root: string): (request: Request) => Promise<Response> {
  const access = new PathAccess([root]);
  return async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const path = resolveAppPath(request.url, root, access);
    if (path === undefined) return notFound();
    let size: number;
    try {
      const info = await stat(path);
      if (!info.isFile()) return notFound();
      size = info.size;
    } catch {
      return notFound();
    }
    return new Response(Readable.toWeb(createReadStream(path)), {
      headers: {
        'Content-Type': contentTypeOf(path),
        'Content-Length': String(size),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}

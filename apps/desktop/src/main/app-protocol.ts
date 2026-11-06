import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { PathAccess } from './path-access';

export const APP_SCHEME = 'reprise';
export const APP_HOST = 'app';
export const APP_INDEX_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

// The longest built asset path is under 60 characters. Without a cap, a megabyte of `a/`
// segments keeps the guard's per-segment realpath walk busy for over a minute inside the asar.
const MAX_PATH_LENGTH = 1024;
const MAX_URL_LENGTH = 4 * MAX_PATH_LENGTH;

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
  if (url.length > MAX_URL_LENGTH) return undefined;
  const { protocol, host, pathname } = new URL(url);
  if (protocol !== `${APP_SCHEME}:` || host !== APP_HOST) return undefined;
  let path: string;
  try {
    // Chromium hands `%2F` over still encoded, so the decoded path is what the guard must stop.
    path = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (path.length > MAX_PATH_LENGTH || path.includes('\0')) return undefined;
  const target = resolve(root, `.${path === '' || path === '/' ? '/index.html' : path}`);
  return access.allows(target) ? target : undefined;
}

const notFound = () => new Response('Not found', { status: 404 });

const ALLOW = 'GET, HEAD';

/**
 * Serves the built renderer. A path outside `root` answers 404 like a missing one. HEAD gets
 * GET's headers and no body; any other method gets 405 with `Allow`. Range is ignored: nothing
 * in the renderer asks for one, so every GET gets the whole file.
 */
export function createAppProtocolHandler(root: string): (request: Request) => Promise<Response> {
  const access = new PathAccess([root]);
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: ALLOW } });
    }
    let path: string | undefined;
    try {
      path = resolveAppPath(request.url, root, access);
    } catch {
      return notFound();
    }
    if (path === undefined) return notFound();
    let size: number;
    try {
      const info = await stat(path);
      if (!info.isFile()) return notFound();
      size = info.size;
    } catch {
      return notFound();
    }
    const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path));
    return new Response(body, {
      headers: {
        'Content-Type': contentTypeOf(path),
        'Content-Length': String(size),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}

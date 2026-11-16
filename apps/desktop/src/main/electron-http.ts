import { Readable } from 'node:stream';

import { net } from 'electron';

import type { HttpGet } from './download-http';

/**
 * One hop over Electron's network stack (system proxy and certificates), with `redirect:
 * 'manual'` so the caller decides about each redirect. Not unit tested: it needs a running
 * Electron; the hop loop around it (`openDownload`) is.
 */
export const electronGet: HttpGet = (url, signal) =>
  new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET', redirect: 'manual' });
    const abort = () => {
      request.abort();
      reject(new Error('The download was cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
    const done = () => {
      signal.removeEventListener('abort', abort);
    };
    request.on('redirect', (status, _method, redirectUrl) => {
      done();
      request.abort();
      resolve({
        status,
        location: redirectUrl,
        body: (async function* () {})(),
        close: () => undefined,
      });
    });
    request.on('response', (response) => {
      // The abort handler stays until the body ends, so a cancel stops a stalled stream too.
      // Electron's types leave the response a bare emitter; at runtime it is a Node Readable,
      // which gives the body backpressure and async iteration.
      if (!(response instanceof Readable)) {
        done();
        request.abort();
        reject(new Error('The network response is not a stream'));
        return;
      }
      response.on('close', done);
      const header = response.headers['content-length'];
      const text = Array.isArray(header) ? header[0] : header;
      const length = text === undefined ? Number.NaN : Number(text);
      // The body is already a Node Readable; closing a response nobody reads ends the request.
      resolve({
        status: response.statusCode,
        ...(Number.isSafeInteger(length) && length >= 0 && { contentLength: length }),
        body: response,
        close: () => {
          request.abort();
        },
      });
    });
    request.on('error', (error) => {
      done();
      reject(error);
    });
    request.end();
  });

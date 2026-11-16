import type { DownloadSource } from './download-machine';
import { parseHttpsUrl, PayloadError } from './validate';

/** One request, redirects not followed: the status, the `Location` and the body of the answer. */
export interface HttpHop {
  status: number;
  location?: string;
  contentLength?: number;
  body: AsyncIterable<Uint8Array>;
  /** Drops the connection; called on a redirect, whose body is not read. */
  close(): void;
}

export type HttpGet = (url: string, signal: AbortSignal) => Promise<HttpHop>;

export const MAX_REDIRECTS = 5;

const isRedirect = (status: number) => [301, 302, 303, 307, 308].includes(status);

/**
 * Opens `url` and follows redirects itself, so each hop is checked: a redirect to anything but
 * `https:` (or to a URL with credentials) ends the download, and so does a sixth redirect.
 * The final answer must be a 200.
 */
export async function openDownload(
  url: string,
  get: HttpGet,
  signal: AbortSignal,
  maxRedirects = MAX_REDIRECTS,
): Promise<DownloadSource> {
  let current = url;
  for (let redirects = 0; ; redirects += 1) {
    const hop = await get(current, signal);
    if (!isRedirect(hop.status)) {
      if (hop.status !== 200) {
        hop.close();
        throw new Error(`The server answered ${String(hop.status)}`);
      }
      return hop.contentLength === undefined
        ? { body: hop.body }
        : { total: hop.contentLength, body: hop.body };
    }
    hop.close();
    if (redirects >= maxRedirects) throw new Error('Too many redirects');
    if (hop.location === undefined) throw new Error('A redirect without a Location');
    try {
      current = parseHttpsUrl(new URL(hop.location, current).href);
    } catch (error) {
      if (error instanceof PayloadError || error instanceof TypeError) {
        throw new Error(`Refused a redirect: ${error.message}`);
      }
      throw error;
    }
  }
}

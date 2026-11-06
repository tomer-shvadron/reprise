export type SoundfontErrorCode = 'missing' | 'network' | 'damaged';

export class SoundfontError extends Error {
  override readonly name = 'SoundfontError';
  readonly code: SoundfontErrorCode;

  constructor(code: SoundfontErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

export type SoundfontProgress = (loaded: number, total: number | undefined) => void;

/** Fetches the GM bank; injected so the packaged desktop app can serve it another way (#93). */
export type SoundfontLoader = (onProgress: SoundfontProgress) => Promise<Uint8Array>;

export const GM_SOUNDFONT_PATH = 'sounds/gm/GeneralUser-GS.sf2';

const MISSING_MESSAGE = `The General MIDI sound bank is missing (${GM_SOUNDFONT_PATH}). Run pnpm sounds:fetch.`;
const MEBIBYTE = 1024 * 1024;

export function gmSoundfontUrl(): URL {
  return new URL(`${import.meta.env.BASE_URL}${GM_SOUNDFONT_PATH}`, document.baseURI);
}

function isRiff(bytes: Uint8Array): boolean {
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/**
 * Streams the bank and reports progress only when the whole percent changes, or every MiB
 * without a `Content-Length`, so 32 MB does not become hundreds of store writes.
 */
export async function fetchSoundfont(
  url: URL | string,
  onProgress: SoundfontProgress,
  fetchFn: typeof fetch = fetch,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (error) {
    throw new SoundfontError('network', `The sound bank could not be loaded: ${String(error)}`, {
      cause: error,
    });
  }
  if (response.status === 404) throw new SoundfontError('missing', MISSING_MESSAGE);
  if (!response.ok) {
    throw new SoundfontError(
      'network',
      `The sound bank could not be loaded: ${String(response.status)} ${response.statusText}`.trim(),
    );
  }
  const header = response.headers.get('Content-Length');
  const total = header === null ? undefined : Number(header) || undefined;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let reported = -1;
  const report = () => {
    const step = total ? Math.floor((loaded / total) * 100) : Math.floor(loaded / MEBIBYTE);
    if (step === reported) return;
    reported = step;
    onProgress(loaded, total);
  };
  try {
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        report();
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      chunks.push(bytes);
      loaded = bytes.length;
      report();
    }
  } catch (error) {
    throw new SoundfontError('network', `The sound bank could not be loaded: ${String(error)}`, {
      cause: error,
    });
  }
  const bytes = concat(chunks, loaded);
  // The dev server answers a missing file with index.html and a 200.
  if (!isRiff(bytes)) throw new SoundfontError('missing', MISSING_MESSAGE);
  return bytes;
}

export const loadGmSoundfont: SoundfontLoader = (onProgress) =>
  fetchSoundfont(gmSoundfontUrl(), onProgress);

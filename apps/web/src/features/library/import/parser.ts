import { parseImport, type ParseOutcome } from './parse-import';
import type { ParseRequest, ParseResponse } from './parse.worker';

export interface Parser {
  /** Takes ownership of `bytes`: they are transferred to the worker. */
  parse(bytes: Uint8Array, fallbackTitle?: string): Promise<ParseOutcome>;
  dispose(): void;
}

interface Pending {
  resolve: (outcome: ParseOutcome) => void;
  reject: (error: Error) => void;
}

function inlineParser(): Parser {
  return { parse: (bytes, fallbackTitle) => parseImport(bytes, fallbackTitle), dispose() {} };
}

/**
 * One parser for one job (a batch): a module worker of its own, so a batch of real songs never
 * holds the main thread. Falls back to parsing inline where there is no `Worker` (jsdom).
 */
export function createParser(): Parser {
  if (typeof Worker === 'undefined') return inlineParser();
  const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, Pending>();
  let next = 0;
  let failure: Error | undefined;

  const fail = (error: Error) => {
    failure = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  worker.addEventListener('message', (event: MessageEvent<ParseResponse>) => {
    const { id, outcome } = event.data;
    pending.get(id)?.resolve(outcome);
    pending.delete(id);
  });
  worker.addEventListener('error', (event) => {
    fail(new Error(event.message || 'The import worker failed'));
  });
  worker.addEventListener('messageerror', () => {
    fail(new Error('The import worker sent a message that could not be read'));
  });

  return {
    parse(bytes, fallbackTitle = '') {
      if (failure) return Promise.reject(failure);
      return new Promise<ParseOutcome>((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve, reject });
        const request: ParseRequest = { id, bytes, fallbackTitle };
        worker.postMessage(request, [bytes.buffer]);
      });
    },
    dispose() {
      worker.terminate();
      fail(new Error('The parser was disposed'));
    },
  };
}

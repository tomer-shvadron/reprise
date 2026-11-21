import type { Score } from '@reprise/model';

import type { NotationDefaults } from '@/state/notation-defaults';

import { nativeOf, parseImport, type NativeOutcome, type ParseOutcome } from './parse-import';
import type { ParseRequest, ParseResponse } from './parse.worker';

export interface Parser {
  /** Takes ownership of `bytes`: they are transferred to the worker. */
  parse(
    bytes: Uint8Array,
    fallbackTitle?: string,
    defaults?: NotationDefaults,
  ): Promise<ParseOutcome>;
  /** The score as native bytes. The score is copied to the worker, not moved. */
  native(score: Score): Promise<NativeOutcome>;
  dispose(): void;
}

interface Pending {
  resolve: (response: ParseResponse) => void;
  reject: (error: Error) => void;
}

function inlineParser(): Parser {
  return {
    parse: (bytes, fallbackTitle, defaults) => parseImport(bytes, fallbackTitle, defaults),
    native: (score) => nativeOf(score),
    dispose() {},
  };
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
    const { id } = event.data;
    pending.get(id)?.resolve(event.data);
    pending.delete(id);
  });
  worker.addEventListener('error', (event) => {
    fail(new Error(event.message || 'The import worker failed'));
  });
  worker.addEventListener('messageerror', () => {
    fail(new Error('The import worker sent a message that could not be read'));
  });

  const send = (
    build: (id: number) => ParseRequest,
    transfer: Transferable[],
  ): Promise<ParseResponse> => {
    if (failure) return Promise.reject(failure);
    return new Promise<ParseResponse>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage(build(id), transfer);
      } catch (error) {
        // A buffer that is detached or cannot be transferred: no response will ever come.
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  return {
    async parse(bytes, fallbackTitle = '', defaults) {
      const response = await send(
        (id) => ({ kind: 'parse', id, bytes, fallbackTitle, ...(defaults && { defaults }) }),
        [bytes.buffer],
      );
      if (response.kind !== 'parse')
        throw new Error('The import worker answered the wrong request');
      return response.outcome;
    },
    async native(score) {
      const response = await send((id) => ({ kind: 'native', id, score }), []);
      if (response.kind !== 'native')
        throw new Error('The import worker answered the wrong request');
      return response.outcome;
    },
    dispose() {
      worker.terminate();
      fail(new Error('The parser was disposed'));
    },
  };
}

// The reference applies to the whole web program, not only this file: worker-only globals also
// type-check in main-thread code. Accepted over a second tsconfig project for one 30-line file.
/// <reference lib="webworker" />
import '@/zod-config';
import type { Score } from '@reprise/model';

import { nativeOf, parseImport, type NativeOutcome, type ParseOutcome } from './parse-import';

export type ParseRequest =
  | { kind: 'parse'; id: number; bytes: Uint8Array; fallbackTitle: string }
  /** A score the app already holds, written as native without reading anything again. */
  | { kind: 'native'; id: number; score: Score };

export type ParseResponse =
  | { kind: 'parse'; id: number; outcome: ParseOutcome }
  | { kind: 'native'; id: number; outcome: NativeOutcome };

function respond(response: ParseResponse): void {
  // The native bytes are moved back, not copied; the score never leaves the worker.
  const transfer =
    response.kind === 'parse'
      ? response.outcome.ok
        ? [response.outcome.parsed.native.buffer]
        : []
      : response.outcome.ok
        ? [response.outcome.native.buffer]
        : [];
  self.postMessage(response, transfer);
}

self.addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  const request = event.data;
  const run =
    request.kind === 'parse'
      ? parseImport(request.bytes, request.fallbackTitle).then((outcome): ParseResponse => ({
          kind: 'parse',
          id: request.id,
          outcome,
        }))
      : nativeOf(request.score).then((outcome): ParseResponse => ({
          kind: 'native',
          id: request.id,
          outcome,
        }));
  run.then(respond).catch((error: unknown) => {
    // An unhandled rejection in a worker never reaches the client's `error` listener, so
    // the caller would wait forever; a failed outcome settles it.
    const message = error instanceof Error ? error.message : String(error);
    const failed = { ok: false, code: 'worker-failed', message } as const;
    self.postMessage(
      request.kind === 'parse'
        ? ({ kind: 'parse', id: request.id, outcome: failed } satisfies ParseResponse)
        : ({ kind: 'native', id: request.id, outcome: failed } satisfies ParseResponse),
    );
  });
});

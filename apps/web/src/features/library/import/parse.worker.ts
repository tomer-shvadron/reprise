// The reference applies to the whole web program, not only this file: worker-only globals also
// type-check in main-thread code. Accepted over a second tsconfig project for one 30-line file.
/// <reference lib="webworker" />
import { parseImport, type ParseOutcome } from './parse-import';

export interface ParseRequest {
  id: number;
  bytes: Uint8Array;
  fallbackTitle: string;
}

export interface ParseResponse {
  id: number;
  outcome: ParseOutcome;
}

self.addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  const { id, bytes, fallbackTitle } = event.data;
  void parseImport(bytes, fallbackTitle)
    .then((outcome) => {
      const response: ParseResponse = { id, outcome };
      // The native bytes are moved back, not copied; the score never leaves the worker.
      const transfer = outcome.ok ? [outcome.parsed.native.buffer] : [];
      self.postMessage(response, transfer);
    })
    .catch((error: unknown) => {
      // An unhandled rejection in a worker never reaches the client's `error` listener, so
      // the caller would wait forever; a failed outcome settles it.
      const message = error instanceof Error ? error.message : String(error);
      const failure: ParseResponse = { id, outcome: { ok: false, code: 'worker-failed', message } };
      self.postMessage(failure);
    });
});

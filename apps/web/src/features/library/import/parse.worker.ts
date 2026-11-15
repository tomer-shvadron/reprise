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
  void parseImport(bytes, fallbackTitle).then((outcome) => {
    const response: ParseResponse = { id, outcome };
    // The native bytes are moved back, not copied; the score never leaves the worker.
    const transfer = outcome.ok ? [outcome.parsed.native.buffer] : [];
    self.postMessage(response, transfer);
  });
});

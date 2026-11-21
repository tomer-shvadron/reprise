// The reference applies to the whole web program, not only this file: worker-only globals also
// type-check in main-thread code (see parse.worker.ts).
/// <reference lib="webworker" />
import '@/zod-config';

import { analyse, type NoteTable, type SongInsights, type SongOutline } from '@/lib/insights';

/** The note table's buffers are transferred, not copied; see `insights-client.ts`. */
export interface InsightsRequest {
  id: number;
  table: NoteTable;
  outline: SongOutline;
}

export type InsightsResponse =
  { id: number; insights: SongInsights } | { id: number; error: string };

self.addEventListener('message', (event: MessageEvent<InsightsRequest>) => {
  const { id, table, outline } = event.data;
  // Every request settles: an unhandled throw in a worker never reaches the client's promise.
  try {
    self.postMessage({ id, insights: analyse(table, outline) } satisfies InsightsResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ id, error: message } satisfies InsightsResponse);
  }
});

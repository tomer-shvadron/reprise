import type { Score } from '@reprise/model';

import {
  analyse,
  noteTableOf,
  songOutline,
  type NoteTable,
  type SongInsights,
  type SongOutline,
} from '@/lib/insights';
import { timelineOf } from '@/state/timeline';

import type { InsightsRequest, InsightsResponse } from './insights.worker';

export interface InsightsClient {
  /**
   * Extracts the note table on the calling thread (cheap, cached per bar) and analyses it in a
   * worker. The table's buffers are transferred, so the score itself is never cloned.
   */
  analyse(score: Score): Promise<SongInsights>;
  dispose(): void;
}

interface Pending {
  resolve: (insights: SongInsights) => void;
  reject: (error: Error) => void;
}

/** What the analysis needs of a score; a bad file must not stop it, so a throw rejects. */
export function requestOf(score: Score): { table: NoteTable; outline: SongOutline } {
  const outline = songOutline(score, timelineOf(score).map);
  const table = noteTableOf(
    score,
    outline.bars.map((bar) => bar.passes),
  );
  return { table, outline };
}

/** The table's typed arrays' buffers, which move to the worker with the message. */
export function buffersOf(table: NoteTable): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const value of Object.values(table)) {
    if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer)
      buffers.push(value.buffer);
  }
  return buffers;
}

function inlineClient(): InsightsClient {
  return {
    analyse: (score) =>
      new Promise((resolve, reject) => {
        try {
          const { table, outline } = requestOf(score);
          resolve(analyse(table, outline));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    dispose() {},
  };
}

/**
 * The insights worker, made on the first request. Falls back to analysing inline where there is no
 * `Worker` (jsdom), as `createParser` does.
 */
export function createInsightsClient(): InsightsClient {
  if (typeof Worker === 'undefined') return inlineClient();
  let worker: Worker | undefined;
  const pending = new Map<number, Pending>();
  let next = 0;

  const failAll = (error: Error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    // A crashed worker is replaced by the next request rather than answering nothing forever.
    worker?.terminate();
    worker = undefined;
  };
  const workerOf = (): Worker => {
    if (worker) return worker;
    const made = new Worker(new URL('./insights.worker.ts', import.meta.url), { type: 'module' });
    made.addEventListener('message', (event: MessageEvent<InsightsResponse>) => {
      const response = event.data;
      const entry = pending.get(response.id);
      pending.delete(response.id);
      if (!entry) return;
      if ('error' in response) entry.reject(new Error(response.error));
      else entry.resolve(response.insights);
    });
    made.addEventListener('error', (event) => {
      failAll(new Error(event.message || 'The insights worker failed'));
    });
    made.addEventListener('messageerror', () => {
      failAll(new Error('The insights worker sent a message that could not be read'));
    });
    worker = made;
    return made;
  };

  return {
    analyse: (score) =>
      new Promise<SongInsights>((resolve, reject) => {
        const id = next++;
        try {
          const { table, outline } = requestOf(score);
          pending.set(id, { resolve, reject });
          workerOf().postMessage(
            { id, table, outline } satisfies InsightsRequest,
            buffersOf(table),
          );
        } catch (error) {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    dispose() {
      failAll(new Error('The insights client was disposed'));
    },
  };
}

import { describe, expect, it, vi } from 'vitest';

import { analyseScore } from '@/lib/insights';
import { aMinorRiff } from '@/test/a-minor-riff';

import type { NoteTable } from '@/lib/insights';

import { buffersOf, createInsightsClient } from './insights-client';
import type { InsightsResponse } from './insights.worker';

describe('the insights worker', () => {
  it('answers what the inline analysis would, from a real module worker', async () => {
    const client = createInsightsClient();
    try {
      const score = aMinorRiff();
      const insights = await client.analyse(score);
      expect(insights).toEqual(JSON.parse(JSON.stringify(analyseScore(score))));
      expect(insights.key.found && insights.key.name).toBe('A minor');
    } finally {
      client.dispose();
    }
  });

  it('transfers the note table to the worker, so the score is never cloned', async () => {
    // Calls through: the spy only records what the client posts.
    const spy = vi.spyOn(Worker.prototype, 'postMessage');
    const client = createInsightsClient();
    try {
      await client.analyse(aMinorRiff());
      const call = spy.mock.calls[0] as [{ table: NoteTable }, Transferable[]] | undefined;
      expect(call).toBeDefined();
      if (!call) return;
      const [message, transfer] = call;
      // Every buffer of the table is in the transfer list, and so detached on this side.
      expect(transfer.length).toBeGreaterThan(0);
      expect(transfer).toEqual(buffersOf(message.table));
      expect(message.table.pitch.byteLength).toBe(0);
    } finally {
      spy.mockRestore();
      client.dispose();
    }
  });

  it('makes a new worker for a request after dispose', async () => {
    const spy = vi.spyOn(Worker.prototype, 'postMessage');
    const client = createInsightsClient();
    try {
      await client.analyse(aMinorRiff());
      client.dispose();
      const again = await client.analyse(aMinorRiff());
      expect(again.key.found).toBe(true);
      expect(new Set(spy.mock.contexts).size).toBe(2);
    } finally {
      spy.mockRestore();
      client.dispose();
    }
  });

  it('settles a request the analysis throws on as an error', async () => {
    const worker = new Worker(new URL('./insights.worker.ts', import.meta.url), {
      type: 'module',
    });
    try {
      const response = await new Promise<InsightsResponse>((resolve, reject) => {
        worker.addEventListener('message', (event: MessageEvent<InsightsResponse>) => {
          resolve(event.data);
        });
        worker.addEventListener('error', (event) => {
          reject(new Error(event.message));
        });
        worker.postMessage({ id: 7 });
      });
      expect(response).toMatchObject({ id: 7 });
      expect('error' in response).toBe(true);
    } finally {
      worker.terminate();
    }
  });
});

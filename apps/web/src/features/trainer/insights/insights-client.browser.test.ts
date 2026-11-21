import { describe, expect, it } from 'vitest';

import { analyseScore } from '@/lib/insights';
import { aMinorRiff } from '@/test/a-minor-riff';

import { buffersOf, createInsightsClient, requestOf } from './insights-client';
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

  it('takes the note table by transfer, so the score is never cloned', () => {
    const { table } = requestOf(aMinorRiff());
    const buffers = buffersOf(table);
    expect(buffers.length).toBeGreaterThan(0);
    const channel = new MessageChannel();
    channel.port1.postMessage(table, buffers);
    expect(table.pitch.byteLength).toBe(0);
    channel.port1.close();
    channel.port2.close();
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

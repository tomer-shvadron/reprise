import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyseScore, type SongInsights } from '@/lib/insights';
import { aMinorRiff } from '@/test/a-minor-riff';
import { createTestServices } from '@/test/services';

import type { InsightsClient } from './insights-client';
import { createInsights, EDIT_DEBOUNCE_MS, SLOW_AFTER_MS } from './insights-store';

/** Advances the timers and lets the promises that were waiting run. */
const tick = (ms = 0) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });

interface Call {
  score: Score;
  resolve: (insights: SongInsights) => void;
  reject: (error: Error) => void;
}

/** A client whose answers the test gives by hand, so the order of events is its own. */
function manualClient() {
  const calls: Call[] = [];
  const disposed = { count: 0 };
  const client: InsightsClient = {
    analyse: (scoreToAnalyse) =>
      new Promise((resolve, reject) => {
        calls.push({ score: scoreToAnalyse, resolve, reject });
      }),
    dispose() {
      disposed.count++;
    },
  };
  return { client, calls, disposed };
}

async function open(services: ReturnType<typeof createTestServices>, name: string) {
  const { bytes } = await write(aMinorRiff(), 'reprise');
  await act(async () => {
    await services.document.getState().openBytes(name, bytes);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the insights store', () => {
  it('analyses only while something retains it', async () => {
    const services = createTestServices();
    const { client, calls } = manualClient();
    const store = createInsights(services, { client });
    await open(services, 'a.reprise');
    await tick();
    expect(calls).toHaveLength(0);
    expect(store.getState().status).toBe('idle');
    store.getState().retain();
    expect(calls).toHaveLength(1);
    expect(store.getState().status).toBe('analysing');
  });

  it('analyses a document open on the next macrotask and caches per score', async () => {
    const services = createTestServices();
    const { client, calls } = manualClient();
    const store = createInsights(services, { client });
    store.getState().retain();
    await open(services, 'a.reprise');
    // Not in the open's own task: extraction would share its frame.
    expect(calls).toHaveLength(0);
    await tick();
    expect(calls).toHaveLength(1);
    const insights = analyseScore(calls[0]?.score ?? aMinorRiff());
    await act(async () => {
      calls[0]?.resolve(insights);
      await Promise.resolve();
    });
    expect(store.getState()).toMatchObject({ status: 'ready', insights });
    // Releasing and retaining again, with the same score, costs no request.
    store.getState().release();
    store.getState().retain();
    expect(calls).toHaveLength(1);
  });

  it('waits for a quiet moment after an edit, keeps the old result meanwhile and drops a stale answer', async () => {
    const services = createTestServices();
    const { client, calls } = manualClient();
    const store = createInsights(services, { client });
    store.getState().retain();
    await open(services, 'a.reprise');
    await tick();
    const first = analyseScore(calls[0]?.score ?? aMinorRiff());
    await act(async () => {
      calls[0]?.resolve(first);
      await Promise.resolve();
    });
    const edited = aMinorRiff();
    act(() => {
      services.document.setState({ score: edited });
    });
    expect(calls).toHaveLength(1);
    expect(store.getState().insights).toBe(first);
    await tick(EDIT_DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(1);
    await tick(1);
    expect(calls).toHaveLength(2);
    // Another edit lands while that request runs; its answer is dropped, and the latest is
    // analysed only after its own quiet moment.
    const newest = aMinorRiff();
    act(() => {
      services.document.setState({ score: newest });
    });
    await act(async () => {
      calls[1]?.resolve(analyseScore(edited));
      await Promise.resolve();
    });
    expect(store.getState().forScore).not.toBe(edited);
    expect(store.getState().insights).toBe(first);
    expect(calls).toHaveLength(2);
    await tick(EDIT_DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(2);
    await tick(1);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.score).toBe(newest);
  });

  it('analyses at once when the quiet moment passed while a request was running', async () => {
    const services = createTestServices();
    const { client, calls } = manualClient();
    const store = createInsights(services, { client });
    store.getState().retain();
    await open(services, 'a.reprise');
    await tick();
    const newest = aMinorRiff();
    act(() => {
      services.document.setState({ score: newest });
    });
    await tick(EDIT_DEBOUNCE_MS);
    expect(calls).toHaveLength(1);
    await act(async () => {
      calls[0]?.resolve(analyseScore(calls[0].score));
      await Promise.resolve();
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.score).toBe(newest);
  });

  it('does not analyse an edit when the store is released during the quiet moment', async () => {
    const services = createTestServices();
    const { client, calls } = manualClient();
    const store = createInsights(services, { client });
    store.getState().retain();
    await open(services, 'a.reprise');
    await tick();
    await act(async () => {
      calls[0]?.resolve(analyseScore(calls[0].score));
      await Promise.resolve();
    });
    act(() => {
      services.document.setState({ score: aMinorRiff() });
    });
    await tick(EDIT_DEBOUNCE_MS - 1);
    store.getState().release();
    await tick(EDIT_DEBOUNCE_MS * 2);
    expect(calls).toHaveLength(1);
  });

  it('ends the worker when nothing wants the insights, and when the document closes', async () => {
    const services = createTestServices();
    const { client, calls, disposed } = manualClient();
    const store = createInsights(services, { client });
    store.getState().retain();
    await open(services, 'a.reprise');
    await tick();
    await act(async () => {
      calls[0]?.resolve(analyseScore(calls[0].score));
      await Promise.resolve();
    });
    expect(disposed.count).toBe(0);
    store.getState().release();
    expect(disposed.count).toBe(1);
    // Nothing retains it: closing the document ends it again (a later request would make a new one).
    act(() => {
      services.document.getState().close();
    });
    expect(disposed.count).toBe(2);
  });

  it('keeps the worker while a request is running after the last release', async () => {
    const services = createTestServices();
    const { client, calls, disposed } = manualClient();
    const store = createInsights(services, { client });
    store.getState().retain();
    await open(services, 'a.reprise');
    await tick();
    store.getState().release();
    expect(disposed.count).toBe(0);
    await act(async () => {
      calls[0]?.resolve(analyseScore(calls[0].score));
      await Promise.resolve();
    });
    expect(disposed.count).toBe(1);
  });

  it('resets on a document switch', async () => {
    const services = createTestServices();
    const { client, calls } = manualClient();
    const store = createInsights(services, { client });
    store.getState().retain();
    await open(services, 'a.reprise');
    await tick();
    await act(async () => {
      calls[0]?.resolve(analyseScore(calls[0].score));
      await Promise.resolve();
    });
    expect(store.getState().status).toBe('ready');
    await open(services, 'b.reprise');
    expect(store.getState()).toMatchObject({ status: 'idle', insights: undefined });
    await tick();
    expect(store.getState()).toMatchObject({ status: 'analysing', insights: undefined });
  });

  it('shows "analysing" only after a delay, and reports a failed analysis', async () => {
    const services = createTestServices();
    const { client, calls } = manualClient();
    const store = createInsights(services, { client });
    store.getState().retain();
    await open(services, 'a.reprise');
    await tick();
    expect(store.getState().slow).toBe(false);
    await tick(SLOW_AFTER_MS);
    expect(store.getState().slow).toBe(true);
    await act(async () => {
      calls[0]?.reject(new Error('boom'));
      await Promise.resolve();
    });
    expect(store.getState()).toMatchObject({ status: 'error', error: 'boom', slow: false });
  });

  it('ensure analyses at once without being retained, and resolves undefined with no score', async () => {
    const services = createTestServices();
    const { client, calls } = manualClient();
    const store = createInsights(services, { client });
    await expect(store.getState().ensure()).resolves.toBeUndefined();
    await open(services, 'a.reprise');
    const pending = store.getState().ensure();
    expect(calls).toHaveLength(1);
    const insights = analyseScore(calls[0]?.score ?? aMinorRiff());
    await act(async () => {
      calls[0]?.resolve(insights);
      await Promise.resolve();
    });
    await expect(pending).resolves.toBe(insights);
    // The cached result answers the next one with no request.
    await expect(store.getState().ensure()).resolves.toBe(insights);
    expect(calls).toHaveLength(1);
  });

  it('resolves an ensure for a score that was replaced with undefined', async () => {
    const services = createTestServices();
    const { client } = manualClient();
    const store = createInsights(services, { client });
    await open(services, 'a.reprise');
    const pending = store.getState().ensure();
    await open(services, 'b.reprise');
    await expect(pending).resolves.toBeUndefined();
  });
});

import type { Score } from '@reprise/model';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { AppServices } from '@/app/services';
import type { SongInsights } from '@/lib/insights';

import { createInsightsClient, type InsightsClient } from './insights-client';

export type InsightsStatus = 'idle' | 'analysing' | 'ready' | 'error';

/** Quiet after the last edit before the analysis runs again. */
export const EDIT_DEBOUNCE_MS = 400;
/** "Analysing…" shows only after this long, so a fast answer never flashes it. */
export const SLOW_AFTER_MS = 300;

export interface InsightsState {
  status: InsightsStatus;
  /** The latest result; kept while a newer one is being worked out, so the panel does not blank. */
  insights: SongInsights | undefined;
  /** The score `insights` was computed for. */
  forScore: Score | undefined;
  error: string | undefined;
  /** The analysis has been running longer than `SLOW_AFTER_MS`. */
  slow: boolean;
  /**
   * A request to show one section of the Sections card (`trainer.sectionInsights`): the master bar
   * index, with a counter so asking for the same section twice scrolls twice.
   */
  focus: { bar: number; request: number } | undefined;
  focusSection: (bar: number) => void;
  /** Something shows the insights (the panel, a song-following overlay): analyse and keep fresh. */
  retain: () => void;
  release: () => void;
  /**
   * The insights of the open score, at once: the cached result, or an analysis that starts now
   * and does not wait for the edit debounce. Resolves `undefined` when there is no score or the
   * analysis failed.
   */
  ensure: () => Promise<SongInsights | undefined>;
}

export type InsightsStore = StoreApi<InsightsState>;
export type InsightsServices = Pick<AppServices, 'document'>;

export interface InsightsDeps {
  client?: InsightsClient;
}

interface Waiter {
  score: Score;
  resolve: (insights: SongInsights | undefined) => void;
}

/**
 * The song insights of the open document. It analyses only while something retains it (or an
 * `ensure` is waiting), at once when a document opens and after a quiet moment following an edit.
 * One request runs at a time and the latest wins; an answer for a score that is no longer open is
 * dropped. Results are cached per score object, so undoing back to an analysed score costs nothing.
 */
export function createInsights(services: InsightsServices, deps: InsightsDeps = {}): InsightsStore {
  const { document } = services;
  let client = deps.client;
  const clientOf = (): InsightsClient => (client ??= createInsightsClient());
  const cache = new WeakMap<Score, SongInsights>();
  const waiters: Waiter[] = [];
  let retained = 0;
  let running = false;
  /** The debounce fired while a request ran: the newest score is owed an analysis. */
  let dirty = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;

  const store = createStore<InsightsState>(() => ({
    status: 'idle',
    insights: undefined,
    forScore: undefined,
    error: undefined,
    slow: false,
    focus: undefined,
    focusSection: (bar) => {
      store.setState((state) => ({ focus: { bar, request: (state.focus?.request ?? 0) + 1 } }));
    },
    retain: () => {
      retained++;
      if (retained === 1) schedule('now');
    },
    release: () => {
      retained = Math.max(0, retained - 1);
      if (retained === 0 && waiters.length === 0) {
        // Nothing shows it: a pending re-analysis would be wasted.
        clearTimeout(debounce);
        debounce = undefined;
        dirty = false;
        idle();
      }
    },
    ensure: () => {
      const { score } = document.getState();
      if (!score) return Promise.resolve(undefined);
      const cached = cache.get(score);
      if (cached) {
        publish(score, cached);
        return Promise.resolve(cached);
      }
      return new Promise((resolve) => {
        waiters.push({ score, resolve });
        schedule('now');
      });
    },
  }));

  const wanted = () => retained > 0 || waiters.length > 0;

  function publish(score: Score, insights: SongInsights) {
    if (store.getState().forScore === score && store.getState().status === 'ready') return;
    store.setState({ status: 'ready', insights, forScore: score, error: undefined, slow: false });
  }

  function settleWaiters(score: Score, insights: SongInsights | undefined) {
    for (let at = waiters.length - 1; at >= 0; at--) {
      const waiter = waiters[at];
      if (waiter && (waiter.score === score || waiter.score !== document.getState().score)) {
        waiters.splice(at, 1);
        waiter.resolve(waiter.score === score ? insights : undefined);
      }
    }
  }

  /** Nothing wants the result: the worker is not kept around (the next request makes a new one). */
  function idle() {
    if (!running && !wanted()) client?.dispose();
  }

  /**
   * Analyse the open score: `'now'` is on this call, a number is after that many ms (0 is the next
   * macrotask, which keeps a document open's extraction off the open's own frame).
   */
  function schedule(delay: number | 'now') {
    clearTimeout(debounce);
    debounce = undefined;
    if (!wanted()) return;
    const { score } = document.getState();
    if (!score) return;
    const cached = cache.get(score);
    if (cached) {
      publish(score, cached);
      return;
    }
    if (delay === 'now') void run();
    else
      debounce = setTimeout(() => {
        debounce = undefined;
        // A request is in flight: it lands stale and then analyses what is open, with no new wait.
        if (running) dirty = true;
        else void run();
      }, delay);
  }

  async function run() {
    // At most one in flight; when it lands, the latest score is looked at again.
    if (running) return;
    const { score, id } = document.getState();
    if (!score) return;
    running = true;
    store.setState({ status: 'analysing', error: undefined });
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => {
      if (store.getState().status === 'analysing') store.setState({ slow: true });
    }, SLOW_AFTER_MS);
    let insights: SongInsights | undefined;
    let failure: string | undefined;
    try {
      insights = await clientOf().analyse(score);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    clearTimeout(slowTimer);
    running = false;
    const now = document.getState();
    const stale = now.score !== score || now.id !== id;
    if (insights) cache.set(score, insights);
    if (!stale) {
      if (insights) publish(score, insights);
      else store.setState({ status: 'error', error: failure, slow: false });
    }
    settleWaiters(score, insights);
    if (stale) {
      store.setState({ slow: false });
      // A document switch owes the new one its analysis now; an edit already has its debounce
      // pending (or it fired during the request, and `dirty` says so).
      if (now.id !== id || dirty) {
        dirty = false;
        schedule('now');
      }
    }
    idle();
  }

  document.subscribe((state, previous) => {
    if (state.score === previous.score && state.id === previous.id) return;
    if (state.id !== previous.id) {
      // Another document: nothing of the old one applies.
      store.setState({
        status: 'idle',
        insights: undefined,
        forScore: undefined,
        error: undefined,
        slow: false,
        focus: undefined,
      });
      for (const waiter of waiters.splice(0)) waiter.resolve(undefined);
      dirty = false;
      schedule(0);
      idle();
      return;
    }
    // An edit: the old result stays on screen until the next one lands.
    const { score } = state;
    if (score && cache.has(score)) schedule('now');
    else schedule(EDIT_DEBOUNCE_MS);
  });

  return store;
}

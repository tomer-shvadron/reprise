import {
  createInsights,
  type InsightsDeps,
  type InsightsServices,
  type InsightsStore,
} from './insights-store';

const stores = new WeakMap<object, InsightsStore>();

/**
 * The song insights of these services, made once: the panel, the commands and the fretboard
 * overlay share it. `deps` only matters on the first call, which tests use to inject a client.
 */
export function insightsFor(services: InsightsServices, deps?: InsightsDeps): InsightsStore {
  let store = stores.get(services.document);
  if (!store) {
    store = createInsights(services, deps);
    stores.set(services.document, store);
  }
  return store;
}

import type { z } from 'zod';

/**
 * A setting is a value made with `defineSetting`: the store is generic over these handles, so a
 * feature adds its settings by defining handles in its own folder and never edits the store.
 */
export interface SettingDef<T> {
  /** Dotted camelCase segments, unique app-wide, e.g. `playback.countIn`. The Dexie row key. */
  readonly key: string;
  readonly schema: z.ZodType<T>;
  readonly default: T;
  /**
   * Read synchronously from `localStorage` under `storageKey`, as a string; for what must be known
   * before the first paint, which IndexedDB cannot do. The theme alone: a new one needs a reason.
   */
  readonly early?: { readonly storageKey: string };
}

/** The value type comes from the schema, so `z.enum([...])` gives the union, not `string`. */
export function defineSetting<S extends z.ZodType>(
  def: SettingDef<z.output<S>> & { readonly schema: S },
): SettingDef<z.output<S>> {
  if (!def.schema.safeParse(def.default).success) {
    throw new Error(`The default of setting "${def.key}" fails its own schema`);
  }
  if (def.early && typeof def.default !== 'string') {
    throw new Error(`The early setting "${def.key}" must have a string value`);
  }
  return def;
}

/** Where the rows live; the Dexie `settings` table in the app, a map in tests. */
export interface SettingsBackend {
  load(): Promise<ReadonlyMap<string, unknown>>;
  put(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** What `reset` and `isStored` need of a handle, whatever its value type. */
export interface SettingKey {
  readonly key: string;
  readonly early?: { readonly storageKey: string } | undefined;
}

export interface SettingsStore {
  get<T>(def: SettingDef<T>): T;
  /** Validates, applies at once and writes through; throws on an invalid value (a programmer error). */
  set<T>(def: SettingDef<T>, value: T): void;
  /** Removes the rows, so the values return to their defaults. */
  reset(defs: readonly SettingKey[]): void;
  /** Whether a value is stored for `def`, as opposed to the default showing through. */
  isStored(def: SettingKey): boolean;
  /** Fires only when the parsed value changes, hydration included. */
  subscribe<T>(def: SettingDef<T>, listener: (value: T, previous: T) => void): () => void;
  hydrated(): boolean;
  whenHydrated(): Promise<void>;
  /** Loads the backend once; a second call returns the same promise (StrictMode runs effects twice). */
  attach(backend: SettingsBackend): Promise<void>;
}

export interface SettingsStoreOptions {
  /** Where early settings live; `window.localStorage` by default. */
  local?: () => Storage;
  /** Values present from the start, as if hydrated. */
  initial?: ReadonlyMap<string, unknown>;
}

interface Subscription {
  def: SettingDef<unknown>;
  listener: (value: unknown, previous: unknown) => void;
  last: unknown;
}

type Pending = { kind: 'put'; value: unknown } | { kind: 'remove' };

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const local = options.local ?? (() => window.localStorage);
  // Raw values by key: rows of the backend, early values read once, and what `set` stored.
  // A row with no handle is kept here and never deleted.
  const values = new Map<string, unknown>(options.initial);
  const earlyRead = new Set<string>();
  // What was set or reset before the backend loaded; it wins over the stored rows.
  const pending = new Map<string, Pending>();
  // The parse of a raw value, keyed by the raw's identity, so an object value keeps its reference.
  const parsed = new Map<string, { raw: unknown; value: unknown }>();
  const subscriptions = new Map<string, Set<Subscription>>();
  const warned = new Set<unknown>();
  let backend: SettingsBackend | undefined;
  let attached: Promise<void> | undefined;
  let isHydrated = options.initial !== undefined;
  let resolveHydrated: () => void = () => undefined;
  const hydration = new Promise<void>((resolve) => {
    resolveHydrated = resolve;
  });
  if (isHydrated) resolveHydrated();

  const readEarly = (def: SettingKey) => {
    if (!def.early || earlyRead.has(def.key)) return;
    earlyRead.add(def.key);
    try {
      const raw = local().getItem(def.early.storageKey);
      if (raw !== null) values.set(def.key, raw);
    } catch {
      // Storage can be disabled; the default shows.
    }
  };

  function read<T>(def: SettingDef<T>): T {
    readEarly(def);
    const raw = values.get(def.key);
    if (raw === undefined) return def.default;
    const hit = parsed.get(def.key);
    if (hit && hit.raw === raw) return hit.value as T;
    const result = def.schema.safeParse(raw);
    let value = def.default;
    if (result.success) {
      value = result.data;
    } else if (!warned.has(raw)) {
      warned.add(raw);
      console.warn(`The stored value of setting "${def.key}" is invalid; using the default`);
    }
    // A structurally equal value keeps the earlier reference.
    const previous = parsed.get(def.key);
    if (previous && sameValue(previous.value, value)) value = previous.value as T;
    parsed.set(def.key, { raw, value });
    return value;
  }

  const emit = (key: string) => {
    for (const subscription of [...(subscriptions.get(key) ?? [])]) {
      const value = read(subscription.def);
      if (sameValue(value, subscription.last)) continue;
      const previous = subscription.last;
      subscription.last = value;
      subscription.listener(value, previous);
    }
  };

  const warnWrite = (what: string) => (error: unknown) => {
    // The value still applies for this session.
    console.warn(`Could not ${what}`, error);
  };

  const write = (key: string, change: Pending) => {
    if (!backend || !isHydrated) {
      pending.set(key, change);
      return;
    }
    // IndexedDB runs transactions over one store in creation order, so the last write wins.
    const done = change.kind === 'put' ? backend.put(key, change.value) : backend.remove(key);
    done.catch(warnWrite(`save the setting "${key}"`));
  };

  const writeEarly = (def: SettingKey, value: string | undefined) => {
    if (!def.early) return;
    try {
      if (value === undefined) local().removeItem(def.early.storageKey);
      else local().setItem(def.early.storageKey, value);
    } catch {
      // Storage can be disabled or full; the setting still applies for this session.
    }
  };

  return {
    get: read,
    set(def, value) {
      const result = def.schema.safeParse(value);
      if (!result.success) {
        throw new Error(`Invalid value for setting "${def.key}": ${result.error.message}`);
      }
      readEarly(def);
      values.set(def.key, result.data);
      if (def.early) writeEarly(def, String(result.data));
      else write(def.key, { kind: 'put', value: result.data });
      emit(def.key);
    },
    reset(defs) {
      for (const def of defs) {
        values.delete(def.key);
        parsed.delete(def.key);
        if (def.early) {
          earlyRead.add(def.key);
          writeEarly(def, undefined);
        } else {
          write(def.key, { kind: 'remove' });
        }
      }
      for (const def of defs) emit(def.key);
    },
    isStored(def) {
      readEarly(def);
      return values.has(def.key);
    },
    subscribe(def, listener) {
      const subscription: Subscription = {
        def,
        listener: listener as Subscription['listener'],
        last: read(def),
      };
      const set = subscriptions.get(def.key) ?? new Set<Subscription>();
      set.add(subscription);
      subscriptions.set(def.key, set);
      return () => {
        set.delete(subscription);
      };
    },
    hydrated: () => isHydrated,
    whenHydrated: () => hydration,
    attach(next) {
      if (attached) return attached;
      backend = next;
      attached = (async () => {
        let rows: ReadonlyMap<string, unknown> = new Map();
        try {
          rows = await next.load();
        } catch (error) {
          console.warn('Could not read the settings; using the defaults', error);
        }
        const changed: string[] = [];
        for (const [key, value] of rows) {
          if (pending.has(key)) continue;
          values.set(key, value);
          changed.push(key);
        }
        isHydrated = true;
        for (const key of changed) emit(key);
        const flush = [...pending];
        pending.clear();
        for (const [key, change] of flush) write(key, change);
        resolveHydrated();
      })();
      return attached;
    },
  };
}

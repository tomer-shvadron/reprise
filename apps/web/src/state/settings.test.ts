import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { memoryStorage } from '@/test/memory-local-storage';
import { createMemorySettingsBackend } from '@/test/settings-backend';

import { defineSetting, createSettingsStore, type SettingsBackend } from './settings';

const FLAG = defineSetting({ key: 'test.flag', schema: z.boolean(), default: false });
const LEVEL = defineSetting({ key: 'test.level', schema: z.number().min(0).max(1), default: 0.5 });
const MAP = defineSetting({
  key: 'test.map',
  schema: z.record(z.string(), z.string()),
  default: {},
});
const MODE = defineSetting({
  key: 'test.mode',
  schema: z.enum(['system', 'light', 'dark']),
  default: 'system',
  early: { storageKey: 'test.mode' },
});

afterEach(() => {
  vi.restoreAllMocks();
});

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

function make(rows: [string, unknown][] = [], local = memoryStorage()) {
  const backend = createMemorySettingsBackend(rows);
  const store = createSettingsStore({ local: () => local });
  return { backend, store, local };
}

describe('defineSetting', () => {
  it('rejects a default that fails its schema, and early on a non-string', () => {
    expect(() => defineSetting({ key: 'x.a', schema: z.number().max(1), default: 2 })).toThrow(
      /fails its own schema/,
    );
    expect(() =>
      defineSetting({ key: 'x.b', schema: z.boolean(), default: true, early: { storageKey: 'b' } }),
    ).toThrow(/must have a string value/);
  });
});

describe('settings store', () => {
  it('reads the defaults before hydration', () => {
    const { store } = make();
    expect(store.hydrated()).toBe(false);
    expect(store.get(FLAG)).toBe(false);
    expect(store.get(LEVEL)).toBe(0.5);
  });

  it('applies stored values on hydration and notifies once per changed key', async () => {
    const { store, backend } = make([
      [FLAG.key, true],
      [LEVEL.key, 0.5],
    ]);
    const onFlag = vi.fn();
    const onLevel = vi.fn();
    store.subscribe(FLAG, onFlag);
    store.subscribe(LEVEL, onLevel);

    await store.attach(backend);

    expect(store.hydrated()).toBe(true);
    expect(onFlag).toHaveBeenCalledExactlyOnceWith(true, false);
    expect(onLevel).not.toHaveBeenCalled();
    expect(store.get(FLAG)).toBe(true);
  });

  it('reads an invalid stored value as the default, warns once and leaves the row', async () => {
    const warn = quiet();
    const { store, backend } = make([[LEVEL.key, 7]]);
    await store.attach(backend);

    expect(store.get(LEVEL)).toBe(0.5);
    expect(store.get(LEVEL)).toBe(0.5);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(backend.rows.get(LEVEL.key)).toBe(7);
  });

  it('keeps rows with no handle', async () => {
    const { store, backend } = make([['future.thing', { a: 1 }]]);
    await store.attach(backend);
    store.set(FLAG, true);
    store.reset([FLAG]);

    expect(backend.rows.get('future.thing')).toEqual({ a: 1 });
  });

  it('validates on set, persists, and notifies only on a change', async () => {
    const { store, backend } = make();
    await store.attach(backend);
    const listener = vi.fn();
    store.subscribe(LEVEL, listener);

    store.set(LEVEL, 0.8);
    store.set(LEVEL, 0.8);

    expect(listener).toHaveBeenCalledExactlyOnceWith(0.8, 0.5);
    expect(backend.rows.get(LEVEL.key)).toBe(0.8);
    expect(() => {
      store.set(LEVEL, 2);
    }).toThrow(/Invalid value/);
    expect(store.get(LEVEL)).toBe(0.8);
  });

  it('stops notifying after unsubscribe', () => {
    const { store } = make();
    const listener = vi.fn();
    const stop = store.subscribe(FLAG, listener);
    stop();
    store.set(FLAG, true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns the same reference for an unchanged object value', async () => {
    const { store, backend } = make([[MAP.key, { a: 'b' }]]);
    await store.attach(backend);

    const first = store.get(MAP);
    expect(store.get(MAP)).toBe(first);
    store.set(MAP, { a: 'b' });
    expect(store.get(MAP)).toBe(first);
    store.set(MAP, { a: 'c' });
    expect(store.get(MAP)).not.toBe(first);
  });

  it('keeps a value set before attach, flushes it, and lets it win over the row', async () => {
    const { store, backend } = make([[FLAG.key, false]]);
    store.set(FLAG, true);
    expect(store.get(FLAG)).toBe(true);

    await store.attach(backend);

    expect(store.get(FLAG)).toBe(true);
    expect(backend.rows.get(FLAG.key)).toBe(true);
  });

  it('removes the rows on reset, so the values return to the defaults', async () => {
    const { store, backend } = make([
      [FLAG.key, true],
      [LEVEL.key, 0.9],
    ]);
    await store.attach(backend);
    const listener = vi.fn();
    store.subscribe(LEVEL, listener);

    store.reset([FLAG, LEVEL]);

    expect(store.get(FLAG)).toBe(false);
    expect(listener).toHaveBeenCalledExactlyOnceWith(0.5, 0.9);
    expect(backend.rows.has(FLAG.key)).toBe(false);
    expect(store.isStored(FLAG)).toBe(false);
  });

  it('keeps the value for the session when a write fails', async () => {
    const warn = quiet();
    const { store, backend } = make();
    const failing: SettingsBackend = {
      ...backend,
      put: () => Promise.reject(new Error('quota')),
    };
    await store.attach(failing);

    store.set(FLAG, true);
    await Promise.resolve();

    expect(store.get(FLAG)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('resolves whenHydrated with the defaults when the load fails', async () => {
    const warn = quiet();
    const { store, backend } = make();
    await store.attach({ ...backend, load: () => Promise.reject(new Error('no idb')) });

    await store.whenHydrated();
    expect(store.hydrated()).toBe(true);
    expect(store.get(FLAG)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('loads once for a second attach', async () => {
    const { store, backend } = make();
    const load = vi.spyOn(backend, 'load');

    const first = store.attach(backend);
    const second = store.attach(backend);

    expect(second).toBe(first);
    await first;
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('early settings', () => {
  it('read localStorage at once and write it synchronously, never touching the backend', async () => {
    const local = memoryStorage();
    local.setItem('test.mode', 'light');
    const { store, backend } = make([], local);
    const put = vi.spyOn(backend, 'put');
    await store.attach(backend);

    expect(store.get(MODE)).toBe('light');
    store.set(MODE, 'dark');
    expect(local.getItem('test.mode')).toBe('dark');
    store.reset([MODE]);
    expect(local.getItem('test.mode')).toBeNull();
    expect(store.get(MODE)).toBe('system');
    expect(put).not.toHaveBeenCalled();
  });

  it('read an unknown stored value as the default', () => {
    quiet();
    const local = memoryStorage();
    local.setItem('test.mode', 'sepia');
    expect(make([], local).store.get(MODE)).toBe('system');
  });

  it('survive a storage that throws', () => {
    const throwing = (): Storage => {
      throw new Error('denied');
    };
    const store = createSettingsStore({ local: throwing });
    expect(store.get(MODE)).toBe('system');
    store.set(MODE, 'light');
    expect(store.get(MODE)).toBe('light');
  });
});

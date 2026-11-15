import { describe, expect, it } from 'vitest';

import { createEditingStore } from './editing';

describe('editing store', () => {
  it('starts out of edit mode', () => {
    expect(createEditingStore().getState().editing).toBe(false);
  });

  it('sets and toggles the flag', () => {
    const store = createEditingStore();
    store.getState().setEditing(true);
    expect(store.getState().editing).toBe(true);
    store.getState().toggle();
    expect(store.getState().editing).toBe(false);
    store.getState().toggle();
    expect(store.getState().editing).toBe(true);
  });
});

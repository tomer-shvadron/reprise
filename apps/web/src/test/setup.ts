import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { Dexie } from 'dexie';
import { afterEach, vi } from 'vitest';

import { settleLibraryWrites } from '@/features/library/library';

import { stubMatchMedia } from './match-media';

// jsdom lacks the layout APIs cmdk and Radix call; stubs are enough since nothing is measured.
class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.scrollIntoView = vi.fn();
stubMatchMedia(false);

afterEach(async () => {
  // A background import still writing would recreate the deleted database under the next test.
  await settleLibraryWrites();
  cleanup();
  // The app's own library database has a fixed name; delete every database so app-level tests
  // never see each other's rows. Dexie closes its open connection on the versionchange.
  const names = (await indexedDB.databases()).flatMap(({ name }) => (name ? [name] : []));
  await Promise.all(names.map((name) => Dexie.delete(name)));
  window.localStorage.clear();
  stubMatchMedia(false);
});

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  stubMatchMedia(false);
});

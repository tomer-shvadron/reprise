import type { AppServices } from '@/app/services';

import type { Clip } from './clipboard-format';

/** The app's own clipboard: the last clip copied or cut, kept across document switches. */
export interface InternalClipboard {
  get(): Clip | undefined;
  set(clip: Clip | undefined): void;
}

const clipboards = new WeakMap<object, InternalClipboard>();

/**
 * The internal clipboard of these services, made on first use. A palette Paste reads it (a page
 * cannot trigger a system paste), and a system paste with an empty clipboard falls back to it.
 */
export function clipboardOf(services: Pick<AppServices, 'entry'>): InternalClipboard {
  const existing = clipboards.get(services.entry);
  if (existing) return existing;
  let clip: Clip | undefined;
  const made: InternalClipboard = {
    get: () => clip,
    set: (next) => {
      clip = next;
    },
  };
  clipboards.set(services.entry, made);
  return made;
}

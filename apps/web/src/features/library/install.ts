import type { AppServices } from '@/app/services';

import { libraryOf } from './library';
import { recentMenuOf } from './recents';

/**
 * Loads the library and keeps the native File menu's Open Recent list in step with it; a pick
 * from that menu opens the song. Returns the undo for both. Nothing happens on the web build,
 * which has no such menu.
 */
export function installLibrary(services: AppServices): () => void {
  const library = libraryOf(services);
  const { platform } = services;
  let last = '';
  let entries: unknown;
  const push = () => {
    if (!platform.setRecentSongs) return;
    // A keystroke in the search box changes the store but not the entries.
    if (library.store.getState().entries === entries) return;
    entries = library.store.getState().entries;
    const items = recentMenuOf(library.store.getState().entries);
    const key = JSON.stringify(items);
    if (key === last) return;
    last = key;
    platform.setRecentSongs(items);
  };
  const unsubscribe = library.store.subscribe(push);
  const unlisten = platform.onOpenRecent?.((id) => {
    void library.openSong(id);
  });
  void library.load();
  return () => {
    unsubscribe();
    unlisten?.();
  };
}

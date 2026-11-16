import { useEffect } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import { useAppServices } from '@/app/services-context';

import { libraryOf } from './library';
import { recentOf } from './recents';

const SHOWN = 5;

/** The songs opened last, as buttons: for the player's empty state. Renders nothing without any. */
export function RecentSongs() {
  const library = libraryOf(useAppServices());
  const entries = useStore(library.store, (state) => state.entries);
  const loaded = useStore(library.store, (state) => state.loaded);

  useEffect(() => {
    if (!loaded) void library.load();
  }, [library, loaded]);

  const recent = recentOf(entries, SHOWN);
  if (recent.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col items-center gap-1">
      <p className="text-ink-muted text-sm">Recent songs</p>
      <ul aria-label="Recent songs" className="flex flex-col items-center">
        {recent.map(({ row }) => (
          <li key={row.id}>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                library.requestOpenSong(row.id);
              }}
            >
              {row.title}
              {row.artist !== '' && ` · ${row.artist}`}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

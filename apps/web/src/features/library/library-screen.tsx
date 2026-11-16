import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Input } from '@/components/ui/input';
import { SongPracticePage } from '@/features/trainer';

import { DeleteDialog } from './delete-dialog';
import { ImportBar } from './import-bar';
import { libraryOf } from './library';
import type { SongRow } from './db/rows';
import { filterEntries, isSortKey, sortEntries, type SortKey } from './search';
import { SongList } from './song-list';

const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title',
  artist: 'Artist',
  lastOpened: 'Last opened',
  imported: 'Recently imported',
};

export function LibraryScreen() {
  const services = useAppServices();
  const library = libraryOf(services);
  const entries = useStore(library.store, (state) => state.entries);
  const loaded = useStore(library.store, (state) => state.loaded);
  const query = useStore(library.store, (state) => state.query);
  const sort = useStore(library.store, (state) => state.sort);
  const error = useStore(library.store, (state) => state.error);
  // Read once per mount: relative dates need not tick while the screen is open.
  const [now] = useState(() => Date.now());
  const [deleting, setDeleting] = useState<SongRow | undefined>();
  const [viewing, setViewing] = useState<SongRow | undefined>();

  useEffect(() => {
    void library.load();
  }, [library]);

  // Filtering keeps the order, so a keystroke only runs the `includes` pass.
  const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);
  const visible = useMemo(() => filterEntries(sorted, query), [sorted, query]);

  if (viewing) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col p-4"
        onKeyDown={(event) => {
          // Escape closes the page before it can close the screen.
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          setViewing(undefined);
        }}
      >
        <SongPracticePage
          song={viewing}
          open={() => library.openSong(viewing.id)}
          onBack={() => {
            setViewing(undefined);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Library</h1>
        <Input
          type="search"
          aria-label="Search songs"
          placeholder="Search title, artist or album"
          className="max-w-sm"
          value={query}
          onChange={(event) => {
            library.setQuery(event.target.value);
          }}
        />
        <label className="text-muted-foreground ml-auto flex items-center gap-2 text-sm">
          Sort by
          <select
            className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
            value={sort}
            onChange={(event) => {
              if (isSortKey(event.target.value)) library.setSort(event.target.value);
            }}
          >
            {Object.entries(SORT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ImportBar library={library} />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {!loaded ? null : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Your library is empty. Import files or a folder, or drop them here: the songs you import
          will appear here.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">No songs match &ldquo;{query}&rdquo;.</p>
      ) : (
        <SongList
          entries={visible}
          now={now}
          onOpen={(id) => {
            void library.openSong(id);
          }}
          onDelete={(id) => {
            setDeleting(entries.find((entry) => entry.row.id === id)?.row);
          }}
          onPracticeLog={(id) => {
            setViewing(entries.find((entry) => entry.row.id === id)?.row);
          }}
        />
      )}
      <DeleteDialog
        song={deleting}
        onCancel={() => {
          setDeleting(undefined);
        }}
        onConfirm={(song) => {
          setDeleting(undefined);
          void library.deleteSong(song.id);
        }}
      />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
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

  // Closing the page returns focus to the song list, on the row whose log was open.
  const wasViewing = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wasViewing.current && !viewing)
      list.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
    wasViewing.current = viewing !== undefined;
  }, [viewing]);

  // Filtering keeps the order, so a keystroke only runs the `includes` pass.
  const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);
  const visible = useMemo(() => filterEntries(sorted, query), [sorted, query]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" inert={viewing !== undefined}>
        <div className="flex items-center gap-3 pr-10">
          <h1 className="text-lg font-semibold">Library</h1>
          <Input
            data-sheet-initial-focus
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
          <div ref={list} className="flex min-h-0 flex-1 flex-col">
            <SongList
              entries={visible}
              now={now}
              onOpen={(id) => {
                void library.requestOpenSong(id);
              }}
              onDelete={(id) => {
                setDeleting(entries.find((entry) => entry.row.id === id)?.row);
              }}
              onPracticeLog={(id) => {
                setViewing(entries.find((entry) => entry.row.id === id)?.row);
              }}
            />
          </div>
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
      {viewing && (
        // Over the list rather than instead of it, so the list keeps its scroll position and its
        // active row for when the page closes.
        <div
          className="bg-background absolute inset-0 z-10 flex min-h-0 flex-col p-4"
          data-sheet-escape-local
          onKeyDown={(event) => {
            // Escape closes the page before it can close the sheet, wherever focus is inside it.
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setViewing(undefined);
          }}
        >
          <SongPracticePage
            song={viewing}
            open={() => library.requestOpenSong(viewing.id)}
            onBack={() => {
              setViewing(undefined);
            }}
          />
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import { useAppServices } from '@/app/services-context';

import { libraryOf } from './library';

/**
 * Shown while the open document is a file the library holds the original of but has not imported
 * (opened without importing, or an import that failed). Importing copies it in and ties the open document to the new song.
 */
export function UnimportedBanner() {
  const services = useAppServices();
  const library = libraryOf(services);
  const documentId = useStore(services.document, (state) => state.id);
  const unimportedId = useStore(library.store, (state) => state.unimportedId);
  const error = useStore(library.store, (state) => state.bannerError);
  const [busy, setBusy] = useState(false);

  // The library's own signal: it holds the original of exactly this document. A new song, a saved
  // copy of one and a song deleted from the library have none, so their Import could not work.
  if (documentId === undefined || unimportedId !== documentId) return null;
  return (
    <div
      role="region"
      aria-label="Unimported song"
      className="bg-muted/50 flex items-center gap-3 border-b px-3 py-1.5 text-sm"
    >
      <span>Not in your library</span>
      <Button
        size="xs"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void library.importOpenDocument().finally(() => {
            setBusy(false);
          });
        }}
      >
        Import
      </Button>
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

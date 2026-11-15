import { useState } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import { useAppServices } from '@/app/services-context';

import { libraryOf } from './library';

/**
 * Shown while a score is open that is not in the library (opened without importing, or an
 * import that failed). Importing copies it in and ties the open document to the new song.
 */
export function UnimportedBanner() {
  const services = useAppServices();
  const library = libraryOf(services);
  const open = useStore(services.document, (state) => state.score !== undefined);
  const songId = useStore(services.document, (state) => state.songId);
  // A never-saved new song has no file, and its Import has nothing to copy.
  const hasFile = useStore(services.document, (state) => state.file !== undefined);
  const error = useStore(library.store, (state) => state.bannerError);
  const [busy, setBusy] = useState(false);

  if (!open || !hasFile || songId !== undefined) return null;
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

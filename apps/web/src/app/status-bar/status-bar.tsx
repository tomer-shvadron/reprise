import { EditStatusLine } from '@/features/editor';
import { SoundStatus } from '@/features/transport';

import { useAppServices } from '@/app/services-context';
import { LibrarySegment, SavedSegment } from './song-status';
import { NotationSegment, ZoomSegment } from './view-status';

/**
 * The window's last row, a fixed 24 px: the song on the left (saved, sound, library), the cursor
 * and the view on the right (the edit state, notation, zoom). It never wraps, so entering edit
 * mode adds no row and moves nothing; a narrow window sheds the lowest priority segments by
 * container width instead.
 *
 * Not a `<footer>`, which would be a second `contentinfo` landmark beside the transport; not a
 * toolbar, which would take the arrow keys; and not a live region, which would read the whole bar
 * at every cursor move. Its background is `bg-background`, never `bg-sidebar`: muted text on that
 * is 4.53:1 in the light theme.
 */
export function StatusBar() {
  const services = useAppServices();
  return (
    <section
      aria-label="Status"
      className="bg-background text-muted-foreground text-2xs @container flex h-6 shrink-0 items-center justify-between gap-3 overflow-hidden border-t px-2 tabular-nums"
    >
      <div role="group" aria-label="Song" className="flex min-w-0 shrink items-center gap-1">
        <SavedSegment />
        <SoundStatus />
        <LibrarySegment />
      </div>
      <div role="group" aria-label="Cursor and view" className="flex min-w-0 items-center gap-1">
        <EditStatusLine
          entry={services.entry}
          editing={services.editing}
          selection={services.selection}
          document={services.document}
          ui={services.ui}
        />
        <NotationSegment />
        <ZoomSegment />
      </div>
    </section>
  );
}

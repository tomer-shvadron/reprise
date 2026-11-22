import { EditStatusLine } from '@/features/editor';
import { TrackFlash } from '@/features/tracks';
import { SoundStatus } from '@/features/transport';

import { useAppServices } from '@/app/services-context';
import { LibrarySegment, SavedSegment } from './song-status';
import { MetronomeSegment } from './click-status';
import { NotationSegment, ZoomSegment } from './view-status';

/**
 * The window's last row, a fixed 24 px: the song on the left (saved, sound, library), the cursor
 * and the view on the right (the edit state, notation, zoom). It never wraps, so entering edit
 * mode adds no row and moves nothing; a narrow window sheds the lowest priority segments by
 * container width instead.
 *
 * Not a `<footer>`, which would be a second `contentinfo` landmark beside the transport; not a
 * toolbar, which would take the arrow keys; and not a live region as a whole, which would read the
 * bar at every cursor move; only the track flash is one. Its background is `bg-background`, a segment's muted text is
 * 5.06:1 on it in the light theme (4.85:1 on `bg-sidebar`).
 */
export function StatusBar() {
  const services = useAppServices();
  return (
    <section
      aria-label="Status"
      className="bg-background text-muted-foreground text-2xs @container flex h-6 shrink-0 items-center justify-between gap-3 overflow-x-clip border-t px-2 tabular-nums"
    >
      <div role="group" aria-label="Song" className="flex min-w-0 shrink items-center gap-1">
        <SavedSegment />
        <SoundStatus />
        <LibrarySegment />
        <MetronomeSegment />
        <TrackFlash />
      </div>
      <div role="group" aria-label="Cursor and view" className="flex min-w-0 items-center gap-1">
        <EditStatusLine
          entry={services.entry}
          editing={services.editing}
          selection={services.selection}
          document={services.document}
        />
        <NotationSegment />
        <ZoomSegment />
      </div>
    </section>
  );
}

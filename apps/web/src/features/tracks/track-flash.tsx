import { useEffect, useState } from 'react';

import { useAppServices } from '@/app/services-context';

import { trackLabel } from './track-model';

const FLASH_MS = 1500;

/**
 * The new current track's number and name in the status bar for a moment after it changes, and
 * the same text to a screen reader as a polite announcement. The region is always mounted and
 * empty at rest, so the first change is read too. Opening a score changes the current track
 * without anyone asking, so only a change between two tracks of the open score flashes.
 */
export function TrackFlash() {
  const { selection, document } = useAppServices();
  const [text, setText] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = selection.subscribe(({ currentTrack }, previous) => {
      if (currentTrack === undefined || currentTrack === previous.currentTrack) return;
      const tracks = document.getState().score?.tracks ?? [];
      const index = tracks.findIndex((track) => track.id === currentTrack);
      const track = tracks[index];
      if (!track || !tracks.some((other) => other.id === previous.currentTrack)) return;
      if (timer !== undefined) clearTimeout(timer);
      setText(`Track ${String(index + 1)}: ${trackLabel(track, index)}`);
      timer = setTimeout(() => {
        setText('');
      }, FLASH_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [selection, document]);

  return (
    <div role="status" aria-live="polite" className="text-foreground min-w-0 truncate">
      {text}
    </div>
  );
}

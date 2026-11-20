import { render, screen } from '@testing-library/react';
import { positionAtSeconds } from '@reprise/model';
import { createRef } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';

import { timelineOf } from '@/state/timeline';
import { stubMatchMedia } from '@/test/match-media';

import { playheadAt, staffBand } from '../playhead';
import { ScoreView, type ScoreViewHandle } from '../score-view';
import { longLayout, sharedLongScore } from './long-score';
import { stubScroll } from './scroll-stub';
import { stubViewport } from './viewport-stub';

// Shared by follow-long.paged.test.tsx and follow-long.continuous.test.tsx, one file per mode so
// Vitest runs them in parallel. Each file keeps its own vi.mock('./fonts'), which is per file.

/** Registers the viewport and scroll stubs each follow-long file needs around its tests. */
export function stubFollowEnvironment(): void {
  const originalScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo');

  beforeEach(() => {
    stubViewport(1280, 800);
    Element.prototype.scrollTo = function scrollTo(
      this: Element,
      options?: ScrollToOptions | number,
    ) {
      if (typeof options !== 'object') return;
      if (options.left !== undefined) this.scrollLeft = options.left;
      if (options.top !== undefined) this.scrollTop = options.top;
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalScrollTo) Object.defineProperty(Element.prototype, 'scrollTo', originalScrollTo);
  });
}

export const song = sharedLongScore();
const { map } = timelineOf(song);
export const trackAt = (index: number) => song.tracks[index]?.id ?? '';

/**
 * Plays the whole long score at 0.1 s steps following `track`, and returns the steps where the
 * playhead was hidden or not on the part of a split system that holds the track.
 */
export function play(
  mode: 'paged' | 'continuous',
  zoom: number,
  reducedMotion: boolean,
  track: string,
): string[] {
  stubMatchMedia(reducedMotion);
  const result = longLayout({ mode, paper: 'a4' });
  const ref = createRef<ScoreViewHandle>();
  const { unmount } = render(<ScoreView ref={ref} layout={result} zoom={zoom} />);
  stubScroll(screen.getByRole('region'));
  const handle = ref.current;
  if (!handle) throw new Error('no handle');
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const misses: string[] = [];
  for (let seconds = 0; seconds <= map.durationSeconds; seconds += 0.1) {
    now += 100;
    const position = positionAtSeconds(map, seconds);
    const masterBar = position && song.masterBars[position.masterBarIndex];
    if (!position || !masterBar) throw new Error('no position');
    const cursor = playheadAt(result, song, masterBar.id, position.tick, track);
    if (!cursor) throw new Error(`no playhead in bar ${String(position.masterBarIndex)}`);
    handle.setPlayhead(cursor);
    handle.followPlayhead({ mode, running: true, track });
    const window = handle.viewport();
    const inX = cursor.x >= window.x && cursor.x <= window.x + window.width;
    const band = mode === 'paged' ? staffBand(result, track, cursor.bar.system) : cursor.box;
    const inY =
      band !== undefined &&
      (mode === 'paged'
        ? band.y >= window.y - 0.5 && band.y + band.height <= window.y + window.height + 0.5
        : band.y < window.y + window.height && band.y + band.height > window.y);
    const system = result.systems[cursor.bar.system];
    const onPart = system?.staves.some((staff) => staff.track === track) ?? false;
    const page = system && result.pages[system.page];
    const onPage =
      page !== undefined &&
      band !== undefined &&
      band.y >= page.bbox.y &&
      band.y + band.height <= page.bbox.y + page.bbox.height;
    if (!inX || !inY || !onPart || !onPage)
      misses.push(`${seconds.toFixed(1)} s, bar ${String(position.masterBarIndex + 1)}`);
  }
  unmount();
  return misses;
}

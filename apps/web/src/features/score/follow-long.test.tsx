import { render, screen } from '@testing-library/react';
import { positionAtSeconds } from '@reprise/model';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { timelineOf } from '@/state/timeline';
import { stubMatchMedia } from '@/test/match-media';

import { columnAnchor } from './anchors';
import { playheadAt, staffBand } from './playhead';
import { ScoreView, type ScoreViewHandle } from './score-view';
import { longLayout, sharedLongScore } from './test/long-score';
import { stubScroll } from './test/scroll-stub';
import { stubViewport } from './test/viewport-stub';

vi.mock('./fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

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

const song = sharedLongScore();
const { map } = timelineOf(song);
const track = song.tracks[0]?.id ?? '';

/** Plays the whole long score at 0.1 s steps and returns the steps where the playhead was hidden. */
function play(mode: 'paged' | 'continuous', zoom: number, reducedMotion: boolean): string[] {
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
    const cursor = playheadAt(result, song, masterBar.id, position.tick);
    if (!cursor) throw new Error(`no playhead in bar ${String(position.masterBarIndex)}`);
    handle.setPlayhead(cursor);
    handle.followPlayhead({ mode, running: true, track });
    const window = handle.viewport();
    const inX = cursor.x >= window.x && cursor.x <= window.x + window.width;
    const band =
      mode === 'paged'
        ? staffBand(result, track, cursor.bar.system)
        : columnAnchor(result, masterBar.id, cursor.bar.system)?.bbox;
    const inY =
      band !== undefined &&
      (mode === 'paged'
        ? band.y >= window.y - 0.5 && band.y + band.height <= window.y + window.height + 0.5
        : band.y < window.y + window.height && band.y + band.height > window.y);
    if (!inX || !inY)
      misses.push(`${seconds.toFixed(1)} s, bar ${String(position.masterBarIndex + 1)}`);
  }
  unmount();
  return misses;
}

describe('following the long score', () => {
  for (const mode of ['paged', 'continuous'] as const) {
    for (const zoom of [1, 2]) {
      it(`keeps the playhead in view for its whole length, ${mode} at zoom ${String(zoom)}`, () => {
        expect(play(mode, zoom, false)).toEqual([]);
        expect(play(mode, zoom, true)).toEqual([]);
      }, 60_000);
    }
  }
});

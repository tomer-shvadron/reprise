import { canShowTab, type Id, type Score } from '@reprise/model';

import { visibleTrackIds, type DocumentView } from '@/state/document';
import type { SelectionState } from '@/state/selection';
import type { MenuTarget } from '@/state/menu-target';

/** What an ASCII tab export covers: the tracks, in score order, and the bars (end exclusive). */
export interface AsciiScope {
  tracks: Id[];
  bars: { start: number; end: number };
}

const between = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

/**
 * The tracks and bars a "Copy as ASCII tab" acts on, from where the menu was opened and the
 * selection. A range covers its tracks (anchor to focus) and bars; a bar-level target is that bar
 * of its track; with only a bar selection in play mode it is the current track. Undefined when
 * there is nothing to take. Pure: the command reads the target before its first await.
 */
export function asciiScopeOf(
  score: Score,
  selection: Pick<SelectionState, 'range' | 'bars' | 'currentTrack'>,
  target: MenuTarget | undefined,
  view: DocumentView,
): AsciiScope | undefined {
  const barIndex = (id: Id) => score.masterBars.findIndex((bar) => bar.id === id);
  const trackIndex = (id: Id) => score.tracks.findIndex((track) => track.id === id);
  // A range is a rectangle over the tracks the view shows, as the editor's own range is.
  const shown = visibleTrackIds(view, score);
  const tracksFrom = (first: number, last: number) =>
    score.tracks
      .slice(first, last + 1)
      .filter((track) => shown === 'all' || shown.includes(track.id))
      .map((track) => track.id);
  const current = selection.currentTrack ?? score.tracks[0]?.id;
  if (target && target.kind !== 'range' && 'masterBar' in target) {
    const bar = barIndex(target.masterBar);
    const track = 'track' in target && target.track !== undefined ? target.track : current;
    if (bar < 0 || track === undefined || trackIndex(track) < 0) return undefined;
    return { tracks: [track], bars: { start: bar, end: bar + 1 } };
  }
  const { range, bars } = selection;
  if (range) {
    const [firstBar, lastBar] = between(
      barIndex(range.anchor.masterBar),
      barIndex(range.focus.masterBar),
    );
    const [firstTrack, lastTrack] = between(
      trackIndex(range.anchor.track),
      trackIndex(range.focus.track),
    );
    if (firstBar < 0 || firstTrack < 0) return undefined;
    const tracks = tracksFrom(firstTrack, lastTrack);
    return tracks.length === 0
      ? undefined
      : { tracks, bars: { start: firstBar, end: lastBar + 1 } };
  }
  if (bars) {
    const [firstBar, lastBar] = between(barIndex(bars.startBar), barIndex(bars.endBar));
    if (firstBar < 0 || current === undefined || trackIndex(current) < 0) return undefined;
    return { tracks: [current], bars: { start: firstBar, end: lastBar + 1 } };
  }
  return undefined;
}

/** Whether any track of the scope has strings; a drum or pitched track alone has no ASCII tab. */
export function hasFrettedTrack(score: Score, tracks: readonly Id[]): boolean {
  return score.tracks.some((track) => tracks.includes(track.id) && canShowTab(track));
}

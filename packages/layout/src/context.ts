import type { Clef, MasterBar, Score, Track } from '@reprise/model';

import type { VisibleTrack } from './options';

/** What a bar shows because of the bars before it. */
export interface BarContext {
  index: number;
  masterBar: MasterBar;
  /** The clef in effect on each visible track, in `ResolvedOptions.tracks` order. */
  clefs: Clef[];
  /** Per visible track: the clef differs from the previous bar's. */
  clefChanges: boolean[];
  showTime: boolean;
  keyChange: boolean;
  isLast: boolean;
}

export function defaultClef(track: Track): Clef {
  return track.display.clef ?? (track.kind === 'drums' ? 'percussion' : 'treble');
}

/** A bar's `clef` holds from that bar until the next bar that sets one. */
export function barContexts(score: Score, tracks: readonly VisibleTrack[]): BarContext[] {
  const clefs = tracks.map(({ track }) => defaultClef(track));
  return score.masterBars.map((masterBar, index): BarContext => {
    const previous = index > 0 ? score.masterBars[index - 1] : undefined;
    const clefChanges = tracks.map(({ track }, t) => {
      const set = track.bars[index]?.clef;
      const before = clefs[t];
      if (set !== undefined) clefs[t] = set;
      return index > 0 && set !== undefined && set !== before;
    });
    return {
      index,
      masterBar,
      clefs: [...clefs],
      clefChanges,
      showTime:
        !previous ||
        previous.timeSignature.numerator !== masterBar.timeSignature.numerator ||
        previous.timeSignature.denominator !== masterBar.timeSignature.denominator,
      keyChange:
        previous !== undefined && previous.keySignature.fifths !== masterBar.keySignature.fifths,
      isLast: index === score.masterBars.length - 1,
    };
  });
}

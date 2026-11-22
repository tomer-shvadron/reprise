import type { SongOutline } from './outline';

/** A chord and the stretch of the song it sounds over: from (`bar`, `onset`) up to, not including, (`endBar`, `endOnset`). */
export interface ChordSpan {
  bar: number;
  onset: number;
  endBar: number;
  endOnset: number;
  name: string;
}

interface Mark {
  bar: number;
  onset: number;
  name: string;
}

const before = (barA: number, onsetA: number, barB: number, onsetB: number): boolean =>
  barA < barB || (barA === barB && onsetA < onsetB);

/**
 * The spans the chord events cover, in written order. A chord lasts until the next one or for
 * `maxHold` bars after its mark, whichever comes first; after that the song has no chord
 * until the next mark. Runs of one name that touch are merged. Events are given in written order.
 */
export function chordTimeline(
  events: readonly Mark[],
  outline: Pick<SongOutline, 'bars'>,
  maxHold: number,
): ChordSpan[] {
  const spans: ChordSpan[] = [];
  const total = outline.bars.length;
  events.forEach((event, index) => {
    const next = events[index + 1];
    let endBar = Math.min(event.bar + maxHold, total);
    let endOnset = 0;
    if (next && before(next.bar, next.onset, endBar, endOnset)) {
      endBar = next.bar;
      endOnset = next.onset;
    }
    if (!before(event.bar, event.onset, endBar, endOnset)) return;
    const last = spans[spans.length - 1];
    if (last?.name === event.name && last.endBar === event.bar && last.endOnset === event.onset) {
      last.endBar = endBar;
      last.endOnset = endOnset;
    } else {
      spans.push({ bar: event.bar, onset: event.onset, endBar, endOnset, name: event.name });
    }
  });
  return spans;
}

export interface ChordTimelineIndex {
  /** The span sounding at `tick` ticks into bar `bar` (an index into the outline's bars), if any. */
  at: (bar: number, tick: number) => ChordSpan | undefined;
}

const indexes = new WeakMap<readonly ChordSpan[], ChordTimelineIndex>();

/**
 * A lookup over a timeline, cached per array so the main thread builds it once per result. The
 * common frame is still inside the span of the frame before, which costs no search; otherwise it is
 * a binary search on the spans' starts.
 */
export function chordTimelineIndex(spans: readonly ChordSpan[]): ChordTimelineIndex {
  const known = indexes.get(spans);
  if (known) return known;
  let last: ChordSpan | undefined;
  const inside = (span: ChordSpan, bar: number, tick: number): boolean =>
    !before(bar, tick, span.bar, span.onset) && before(bar, tick, span.endBar, span.endOnset);
  const index: ChordTimelineIndex = {
    at(bar, tick) {
      if (last && inside(last, bar, tick)) return last;
      let low = 0;
      let high = spans.length - 1;
      let found = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const span = spans[mid];
        if (span && !before(bar, tick, span.bar, span.onset)) {
          found = mid;
          low = mid + 1;
        } else high = mid - 1;
      }
      const span = found >= 0 ? spans[found] : undefined;
      last = span && inside(span, bar, tick) ? span : undefined;
      return last;
    },
  };
  indexes.set(spans, index);
  return index;
}

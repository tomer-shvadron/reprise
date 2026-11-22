import { describe, expect, it } from 'vitest';

import { chordTimeline, chordTimelineIndex, type ChordSpan } from './chord-timeline';
import { MAX_HOLD_BARS } from './chords-used';

const bars = (count: number) => ({ bars: Array.from({ length: count }, () => ({})) as never[] });
const mark = (bar: number, onset: number, name: string) => ({ bar, onset, name });

describe('chordTimeline', () => {
  it('holds a chord until the next, mid-bar marks included', () => {
    expect(chordTimeline([mark(0, 0, 'Am'), mark(1, 480, 'F')], bars(4), MAX_HOLD_BARS)).toEqual([
      { bar: 0, onset: 0, endBar: 1, endOnset: 480, name: 'Am' },
      { bar: 1, onset: 480, endBar: 4, endOnset: 0, name: 'F' },
    ]);
  });

  it('stops a hold after the cap', () => {
    const [span] = chordTimeline([mark(2, 0, 'C')], bars(40), MAX_HOLD_BARS);
    expect(span).toMatchObject({ bar: 2, endBar: 2 + MAX_HOLD_BARS, endOnset: 0 });
  });

  it('merges a run of one name that touches, not one across a gap', () => {
    const touching = chordTimeline([mark(0, 0, 'G'), mark(1, 0, 'G')], bars(20), MAX_HOLD_BARS);
    expect(touching).toEqual([{ bar: 0, onset: 0, endBar: 9, endOnset: 0, name: 'G' }]);
    const gap = chordTimeline([mark(0, 0, 'G'), mark(12, 0, 'G')], bars(20), MAX_HOLD_BARS);
    expect(gap).toHaveLength(2);
  });

  it('is empty without events', () => {
    expect(chordTimeline([], bars(4), MAX_HOLD_BARS)).toEqual([]);
  });
});

describe('chordTimelineIndex', () => {
  const spans: ChordSpan[] = [
    { bar: 1, onset: 0, endBar: 3, endOnset: 0, name: 'Am' },
    { bar: 3, onset: 0, endBar: 4, endOnset: 240, name: 'F' },
    { bar: 6, onset: 120, endBar: 8, endOnset: 0, name: 'C' },
  ];
  const at = chordTimelineIndex(spans).at;

  it('finds nothing before the first span or in a gap', () => {
    expect(at(0, 900)).toBeUndefined();
    expect(at(5, 0)).toBeUndefined();
    expect(at(6, 119)).toBeUndefined();
  });

  it('includes a start and excludes an end', () => {
    expect(at(1, 0)?.name).toBe('Am');
    expect(at(2, 999)?.name).toBe('Am');
    expect(at(3, 0)?.name).toBe('F');
    expect(at(4, 239)?.name).toBe('F');
    expect(at(4, 240)).toBeUndefined();
    expect(at(6, 120)?.name).toBe('C');
    expect(at(8, 0)).toBeUndefined();
  });

  it('is cached per timeline and answers a repeated bar the same each pass', () => {
    expect(chordTimelineIndex(spans)).toBe(chordTimelineIndex(spans));
    expect(at(2, 10)).toBe(at(2, 10));
    at(7, 0);
    expect(at(2, 10)?.name).toBe('Am');
  });

  it('agrees with a linear scan across many spans', () => {
    const many: ChordSpan[] = [];
    for (let bar = 0; bar < 200; bar += 3) {
      many.push({
        bar,
        onset: 0,
        endBar: bar + 2,
        endOnset: bar % 2 ? 0 : 300,
        name: `C${String(bar)}`,
      });
    }
    const lookup = chordTimelineIndex(many);
    const scan = (bar: number, tick: number) =>
      many.find(
        (s) =>
          (bar > s.bar || (bar === s.bar && tick >= s.onset)) &&
          (bar < s.endBar || (bar === s.endBar && tick < s.endOnset)),
      );
    for (let bar = 0; bar < 205; bar++) {
      for (const tick of [0, 100, 299, 300, 700]) {
        expect(lookup.at(bar, tick)).toBe(scan(bar, tick));
        expect(lookup.at(204 - bar, tick)).toBe(scan(204 - bar, tick));
      }
    }
  });
});

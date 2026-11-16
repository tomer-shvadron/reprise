import { layout, PAGE_SIZES, type LayoutResult, type TextPrimitive } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { wordFieldRect, type WordTarget } from './geometry';
import { must } from './test/must';

type Notation = 'tab' | 'standard' | 'both';
type BeatSpec = NonNullable<Parameters<ReturnType<ReturnType<typeof score>['track']>['beat']>[2]>;

function track(beat: BeatSpec): Score {
  const built = score().track('guitar');
  built
    .bar()
    .beat('4', [note(1, 0)], beat)
    .beat('4', [note(2, 1)]);
  return built.build({ ids: 'sequential' });
}

function laid(built: Score, notation: Notation): LayoutResult {
  const id = must(built.tracks[0]).id;
  return layout(built, {
    mode: 'paged',
    width: PAGE_SIZES.a4.width,
    zoom: 1,
    tracks: 'all',
    notation: { [id]: notation },
  });
}

const target = (built: Score, kind: WordTarget['kind'], line = 0): WordTarget => ({
  kind,
  trackId: must(built.tracks[0]).id,
  beatId: must(built.tracks[0]?.bars[0]?.voices[0]?.beats[0]).id,
  line,
});

const drawn = (result: LayoutResult, lane: string): TextPrimitive =>
  must(result.primitives.find((p): p is TextPrimitive => p.kind === 'text' && p.lane === lane));

/** The baseline a field's box sits on: its top plus the size it was lifted by. */
const baseline = (rect: { y: number; size: number }) => rect.y + rect.size * 1.1;

describe('wordFieldRect', () => {
  it('puts line 2 on its own row below a beat that has only line 1, not on line 1', () => {
    const built = track({ lyrics: ['one'] });
    const result = laid(built, 'tab');
    const one = baseline(must(wordFieldRect(result, target(built, 'lyric', 0))));
    const two = baseline(must(wordFieldRect(result, target(built, 'lyric', 1))));
    expect(one).toBeCloseTo(drawn(result, 'lyric:0').y, 1);
    expect(two).toBeGreaterThan(one + 10);
  });

  it('puts line 1 on the line-1 row when only line 2 is written', () => {
    const built = track({ lyrics: ['', 'two'] });
    const result = laid(built, 'tab');
    const two = drawn(result, 'lyric:1').y;
    const first = baseline(must(wordFieldRect(result, target(built, 'lyric', 0))));
    expect(first).toBeLessThan(two - 10);
    expect(baseline(must(wordFieldRect(result, target(built, 'lyric', 1))))).toBeCloseTo(two, 1);
  });

  it('finds the chord row on the tab in both mode, and on an empty beat', () => {
    const built = track({ chord: { name: 'C' } });
    const result = laid(built, 'both');
    const chord = drawn(result, 'chord');
    const rect = must(wordFieldRect(result, target(built, 'chord')));
    expect(baseline(rect)).toBeCloseTo(chord.y, 1);
    // The second beat has no chord: the field sits on the same row.
    const second = must(
      wordFieldRect(result, {
        ...target(built, 'chord'),
        beatId: must(built.tracks[0]?.bars[0]?.voices[0]?.beats[1]).id,
      }),
    );
    expect(baseline(second)).toBeCloseTo(chord.y, 1);
    const tab = must(result.systems[0]?.staves.find((s) => s.type === 'tab'));
    expect(baseline(second)).toBeGreaterThan(must(result.systems[0]?.staves[0]).bottom);
    expect(baseline(second)).toBeLessThan(tab.top);
  });

  it('keeps a chord and beat text that starts with it apart', () => {
    const built = track({ chord: { name: 'C' }, text: 'Coda' });
    const result = laid(built, 'tab');
    expect(baseline(must(wordFieldRect(result, target(built, 'chord'))))).toBeCloseTo(
      drawn(result, 'chord').y,
      1,
    );
    expect(baseline(must(wordFieldRect(result, target(built, 'text'))))).toBeCloseTo(
      drawn(result, 'text').y,
      1,
    );
    expect(drawn(result, 'text').y).not.toBe(drawn(result, 'chord').y);
  });

  it('sits on the empty chord, text and lyric rows of a standard-only staff', () => {
    const built = track({});
    const result = laid(built, 'standard');
    const staff = must(result.systems[0]?.staves[0]);
    const chord = must(wordFieldRect(result, target(built, 'chord')));
    const lyric = must(wordFieldRect(result, target(built, 'lyric', 0)));
    expect(baseline(chord)).toBeLessThan(staff.top);
    expect(baseline(lyric)).toBeGreaterThan(staff.bottom);
    expect(lyric.align).toBe('middle');
  });

  it('is undefined for a beat that is not drawn', () => {
    const built = track({});
    expect(
      wordFieldRect(laid(built, 'tab'), { ...target(built, 'chord'), beatId: 'nope' }),
    ).toBeUndefined();
  });
});

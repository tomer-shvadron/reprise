import { beatTicks } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { ClipTrack } from './clipboard-format';
import { reflow } from './reflow';
import { valuesFor, rhythmTicks } from './rhythm';

/** A clip track of one bar: these beats (as `[duration, fret]`), 4/4, from voice 0. */
function clipOfBeats(beats: [string, number][], offset = 0): ClipTrack {
  const b = score().track('guitar');
  const bar = b.bar();
  for (const [duration, fret] of beats) bar.beat(duration as '4', [note(1, fret)]);
  const built = b.build({ ids: 'sequential', validate: false });
  const track = built.tracks[0];
  if (!track) throw new Error('no track');
  return {
    kind: 'fretted',
    tuning: [...track.tuning],
    fretCount: track.fretCount,
    capo: 0,
    name: 'x',
    bars: [
      {
        timeSignature: { numerator: 4, denominator: 4 },
        voices: [{ voice: 0, offset, beats: track.bars[0]?.voices[0]?.beats ?? [] }],
      },
    ],
  };
}

const cap = (ticks: number) => () => ticks;

describe('reflow', () => {
  it('starts in the next bar when the anchor is the end of a full bar', () => {
    const flow = reflow(clipOfBeats([['4', 1]]), 0, 3840, 0, cap(3840));
    expect('refused' in flow).toBe(false);
    if ('refused' in flow) return;
    expect(flow.voices[0]?.segments).toMatchObject([{ bar: 1, start: 0 }]);
  });

  it('cuts a whole note over several short bars, longest values first', () => {
    const flow = reflow(clipOfBeats([['1', 1]]), 0, 480, 0, cap(1920));
    if ('refused' in flow) throw new Error(flow.refused);
    const segments = flow.voices[0]?.segments ?? [];
    expect(segments.map(({ bar, start }) => [bar, start])).toEqual([
      [0, 480],
      [1, 0],
      [2, 0],
    ]);
    expect(
      segments.map(({ beats }) => beats.reduce((sum, beat) => sum + beatTicks(beat), 0)),
    ).toEqual([1440, 1920, 480]);
    expect(flow.split).toBe(1);
  });

  it('keeps a voice leading offset as an offset and fills a gap between bars with rests', () => {
    const track = clipOfBeats([['4', 1]], 960);
    const [bar] = track.bars;
    if (!bar) throw new Error('no bar');
    const second = { ...bar, voices: bar.voices.map((voice) => ({ ...voice, offset: 480 })) };
    const two: ClipTrack = { ...track, bars: [{ ...bar, ticks: 3840 }, second] };
    const flow = reflow(two, 0, 0, 0, cap(3840));
    if ('refused' in flow) throw new Error(flow.refused);
    const [segment, next] = flow.voices[0]?.segments ?? [];
    expect(segment?.start).toBe(960);
    // The beat and the rest to the barline, then the rest's remaining eighth and the second bar's beat.
    expect(segment?.beats.map(({ rest }) => rest)).toEqual([false, true]);
    expect(next?.beats.map(({ rest }) => rest)).toEqual([true, false]);
    expect(next?.start).toBe(0);
  });
});

describe('valuesFor', () => {
  it('splits a length into the longest values first, down to a 256th', () => {
    expect(valuesFor(1440)?.map(({ duration, dots }) => [duration, dots])).toEqual([[4, 1]]);
    expect(valuesFor(15)?.map(({ duration }) => duration)).toEqual([256]);
    const values = valuesFor(3840 + 480 + 15);
    expect(values?.reduce((sum, value) => sum + rhythmTicks(value), 0)).toBe(3840 + 480 + 15);
  });

  it('is undefined when no value fits the length', () => {
    expect(valuesFor(7)).toBeUndefined();
  });
});

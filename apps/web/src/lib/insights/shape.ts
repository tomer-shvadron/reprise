import { DEFAULT_BPM, type KeySignature, type TimeSignature } from '@reprise/model';

import type { SongOutline, TempoChange } from './outline';
import { sectionSpans } from './sections';

export interface BarRange {
  fromBar: number;
  toBar: number;
}

export interface SongShape {
  barsWritten: number;
  /** Bars counting every repeat and jump, as playback plays them. */
  barsPlayed: number;
  /** The length of a playback at the written tempo. */
  seconds: number;
  tempo: {
    start: number;
    min: number;
    max: number;
    /** Every stretch whose tempo differs from the one before: a ramp has different ends. */
    changes: (TempoChange & { ramp: boolean })[];
  };
  timeSignatures: (TimeSignature & BarRange)[];
  keySignatures: (KeySignature & BarRange)[];
  sections: (BarRange & { name: string; seconds: number })[];
}

/** Runs of bars whose `value` reads the same, as ranges. */
function runs<T>(
  count: number,
  value: (bar: number) => T,
  same: (a: T, b: T) => boolean,
): (BarRange & { value: T })[] {
  const result: (BarRange & { value: T })[] = [];
  for (let bar = 0; bar < count; bar++) {
    const here = value(bar);
    const last = result[result.length - 1];
    if (last && same(last.value, here)) last.toBar = bar;
    else result.push({ fromBar: bar, toBar: bar, value: here });
  }
  return result;
}

export function songShape(outline: SongOutline): SongShape {
  const bars = outline.bars;
  const tempos = outline.tempos;
  const speeds = tempos.flatMap((change) => [change.startBpm, change.endBpm]);
  const start = tempos[0]?.startBpm ?? DEFAULT_BPM;
  return {
    barsWritten: bars.length,
    barsPlayed: bars.reduce((sum, bar) => sum + bar.passes, 0),
    seconds: outline.seconds,
    tempo: {
      start,
      min: Math.min(start, ...speeds),
      max: Math.max(start, ...speeds),
      changes: tempos
        .slice(tempos[0]?.startBpm === tempos[0]?.endBpm ? 1 : 0)
        .map((change) => ({ ...change, ramp: change.startBpm !== change.endBpm })),
    },
    timeSignatures: runs(
      bars.length,
      (bar) => bars[bar]?.timeSignature,
      (a, b) => a?.numerator === b?.numerator && a?.denominator === b?.denominator,
    ).flatMap(({ value, ...range }) => (value ? [{ ...value, ...range }] : [])),
    keySignatures: runs(
      bars.length,
      (bar) => bars[bar]?.keySignature,
      (a, b) => a?.fifths === b?.fifths && a?.minor === b?.minor,
    ).flatMap(({ value, ...range }) => (value ? [{ ...value, ...range }] : [])),
    sections: sectionSpans(outline).map((span) => {
      let seconds = 0;
      for (let bar = span.fromBar; bar <= span.toBar; bar++) seconds += bars[bar]?.seconds ?? 0;
      return { ...span, seconds };
    }),
  };
}

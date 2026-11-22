import { barTicks, beatTicks, createBeat, type Beat, type Tuplet } from '@reprise/model';

import type { ClipTrack } from './clipboard-format';
import { rhythmTicks, ticksOf, valuesFor, type Rhythm } from './rhythm';
import { splitBeat } from './split-beat';

const EPSILON = 1e-6;

/** What one voice of a clip puts in one target bar: where it starts in the bar, and its beats. */
export interface Segment {
  /** Bars from the anchor's bar: 0 is the anchor's own. */
  bar: number;
  start: number;
  beats: Beat[];
  /** Only rests that fill a gap inside the clip's voice, nothing the clip holds. */
  gapOnly: boolean;
}

export interface VoiceFlow {
  /** The voice index in the clip. */
  voice: number;
  segments: Segment[];
}

export interface Flow {
  voices: VoiceFlow[];
  /** Notes that a barline cut into tied pieces. */
  split: number;
}

interface Item {
  start: number;
  ticks: number;
  beat: Beat | undefined;
}

const tupletName = ({ n, of }: Tuplet): string =>
  n === 3 && of === 2 ? 'triplet' : `${String(n)}:${String(of)}`;

/**
 * How much of the timeline each clip bar takes: the bar's played length, less what the range
 * left out of the first bar. A clip from an older build has no length, so the written length or
 * its longest voice stands in.
 */
function barLengths(track: ClipTrack, start: number): number[] {
  return track.bars.map((bar, k) => {
    const skipped = k === 0 ? start : 0;
    if (bar.ticks !== undefined) return bar.ticks - skipped;
    const longest = Math.max(0, ...bar.voices.map(({ offset, beats }) => offset + ticksOf(beats)));
    return Math.max(barTicks({ timeSignature: bar.timeSignature }) - skipped, longest);
  });
}

/** Each voice of the clip as beats with onsets from the clip's start, a rest in every gap. */
function streams(track: ClipTrack, start: number): Map<number, Item[]> {
  const lengths = barLengths(track, start);
  const found = new Map<number, Item[]>();
  let origin = 0;
  for (const [k, bar] of track.bars.entries()) {
    for (const entry of bar.voices) {
      if (entry.beats.length === 0) continue;
      const items = found.get(entry.voice) ?? [];
      let at = origin + entry.offset;
      const end = items.at(-1);
      const filled = end ? end.start + end.ticks : at;
      if (at > filled + EPSILON) items.push({ start: filled, ticks: at - filled, beat: undefined });
      else at = Math.max(at, filled);
      for (const beat of entry.beats) {
        const ticks = beatTicks(beat);
        items.push({ start: at, ticks, beat });
        at += ticks;
      }
      found.set(entry.voice, items);
    }
    origin += lengths[k] ?? 0;
  }
  return found;
}

const restBeat = (value: Rhythm): Beat =>
  createBeat({
    duration: value.duration,
    dots: value.dots,
    rest: true,
    ...(value.tuplet && { tuplet: value.tuplet }),
  });

/**
 * Lays a clip track out again from `anchorTick` of the target's first bar, cutting each beat at
 * the target's barlines. `capacity(j)` is how long the j-th bar from the anchor's lasts. A beat
 * over a barline becomes tied beats, one run per bar (`splitBeat`); a barline inside a tuplet
 * beat, or a piece no note value can write, refuses.
 */
export function reflow(
  track: ClipTrack,
  clipStart: number,
  anchorTick: number,
  anchorBar: number,
  capacity: (bar: number) => number,
): Flow | { refused: string } {
  const bounds = [0];
  const boundary = (bar: number): number => {
    while (bounds.length <= bar + 1) {
      const next = bounds.length - 1;
      bounds.push((bounds[next] ?? 0) + capacity(next));
    }
    return bounds[bar + 1] ?? 0;
  };
  const startOf = (bar: number): number => (bar === 0 ? 0 : boundary(bar - 1));
  const label = (bar: number) => `Bar ${String(anchorBar + bar + 1)}`;

  let split = 0;
  const voices: VoiceFlow[] = [];
  for (const [voice, items] of [...streams(track, clipStart)].sort(([a], [b]) => a - b)) {
    const segments: Segment[] = [];
    for (const item of items) {
      const from = anchorTick + item.start;
      const to = from + item.ticks;
      let bar = 0;
      while (from >= boundary(bar) - EPSILON) bar += 1;
      const pieces: { bar: number; start: number; ticks: number }[] = [];
      let at = from;
      while (at < to - EPSILON) {
        const end = Math.min(to, boundary(bar));
        pieces.push({ bar, start: at - startOf(bar), ticks: end - at });
        at = end;
        if (at >= boundary(bar) - EPSILON) bar += 1;
      }
      const first = pieces[0];
      if (!first) continue;
      const cut = pieces.length > 1;
      let made: { bar: number; start: number; beat: Beat }[];
      if (!cut && item.beat) {
        made = [{ bar: first.bar, start: first.start, beat: item.beat }];
      } else {
        if (cut && item.beat?.tuplet) {
          return {
            refused: `${label(pieces[1]?.bar ?? first.bar)} would cut a ${tupletName(item.beat.tuplet)} at the barline: paste where the tuplet fits, or copy whole bars`,
          };
        }
        const runs: Rhythm[][] = [];
        for (const piece of pieces) {
          const values = valuesFor(piece.ticks);
          if (!values) {
            return {
              refused: `${label(piece.bar)}: the barline would split a beat into lengths no note value can write`,
            };
          }
          runs.push(values);
        }
        const flat = runs.flat();
        const beats = item.beat
          ? splitBeat(item.beat, flat, track.kind)
          : flat.map((value) => restBeat(value));
        if (item.beat && !item.beat.rest && track.kind !== 'drums') {
          split += item.beat.notes.length;
        }
        made = [];
        let index = 0;
        for (const [p, run] of runs.entries()) {
          const piece = pieces[p];
          let offset = piece?.start ?? 0;
          for (const value of run) {
            const beat = beats[index];
            index += 1;
            if (!piece || !beat) continue;
            made.push({ bar: piece.bar, start: offset, beat });
            offset += rhythmTicks(value);
          }
        }
      }
      for (const { bar: where, start, beat } of made) {
        const last = segments.at(-1);
        if (last && last.bar === where) {
          last.beats.push(beat);
          last.gapOnly &&= item.beat === undefined;
        } else {
          segments.push({ bar: where, start, beats: [beat], gapOnly: item.beat === undefined });
        }
      }
    }
    voices.push({ voice, segments });
  }
  return { voices, split };
}

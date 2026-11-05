import { PPQ, type Duration, type TimeSignature, type Tuplet } from '@reprise/model';

const WHOLE = PPQ * 4;
const TICK_EPSILON = 1e-6;

/** One beat of a voice as rhythm notation sees it. */
export interface RhythmEvent {
  /** Ticks from the bar start, and the real length after dots and tuplets. */
  tick: number;
  ticks: number;
  duration: Duration;
  dots: number;
  tuplet?: Tuplet;
  /** A rest or an empty beat: it takes no stem and breaks a beam. */
  silent: boolean;
}

/** Flags or beams a duration carries: one for an eighth, two for a sixteenth, and so on. */
export function beamCount(duration: Duration): number {
  return duration >= 8 ? Math.log2(duration) - 2 : 0;
}

/**
 * Where beams may run within a bar, as consecutive spans in ticks repeated to the bar's end:
 * `eighths` for groups of eighths, `shorter` once a group holds a sixteenth or shorter.
 */
export interface BeamGrouping {
  eighths: readonly number[];
  shorter: readonly number[];
}

/**
 * The beat grouping of a time signature, as Guitar Pro beams by default:
 *
 * | Signature                         | Eighths                     | Sixteenths and shorter |
 * | --------------------------------- | --------------------------- | ---------------------- |
 * | 4/4                               | half bars (two quarters)    | quarters               |
 * | other x/4                         | quarters                    | quarters               |
 * | 6/8, 9/8, 12/8 (x/8, x/16 by 3s)  | dotted quarters (eighths)   | the same               |
 * | 3/8                               | the whole bar               | the same               |
 * | other x/8 and x/16                | pairs, the last of three    | the same               |
 * | x/2 and x/1                       | halves                      | quarters               |
 */
export function beamGrouping({ numerator, denominator }: TimeSignature): BeamGrouping {
  const unit = WHOLE / denominator;
  if (denominator >= 8) {
    if (numerator % 3 === 0) {
      const spans = Array.from({ length: numerator / 3 }, () => unit * 3);
      return { eighths: spans, shorter: spans };
    }
    const pairs = Array.from({ length: Math.floor(numerator / 2) }, () => unit * 2);
    if (numerator % 2 === 1) {
      if (pairs.length > 0) pairs[pairs.length - 1] = unit * 3;
      else pairs.push(unit);
    }
    return { eighths: pairs, shorter: pairs };
  }
  if (denominator === 4) {
    const quarters = Array.from({ length: numerator }, () => PPQ);
    return numerator === 4
      ? { eighths: [PPQ * 2, PPQ * 2], shorter: quarters }
      : { eighths: quarters, shorter: quarters };
  }
  return { eighths: [PPQ * 2], shorter: [PPQ] };
}

/** Index of the span holding `tick`, the spans repeating once they run out. */
function spanIndex(spans: readonly number[], tick: number): number {
  const total = spans.reduce((sum, span) => sum + span, 0);
  const cycles = Math.floor((tick + TICK_EPSILON) / total);
  let start = cycles * total;
  for (const [i, span] of spans.entries()) {
    if (tick + TICK_EPSILON < start + span) return cycles * spans.length + i;
    start += span;
  }
  return (cycles + 1) * spans.length;
}

/** A run of beats under one tuplet number, by index into the voice's events, end inclusive. */
export interface TupletGroup {
  start: number;
  end: number;
  n: number;
  of: number;
}

/**
 * Consecutive beats with the same tuplet ratio, cut whenever their written lengths add up to `n`
 * of the shortest among them: three triplet eighths, or a triplet quarter and eighth.
 */
export function tupletGroups(events: readonly RhythmEvent[]): TupletGroup[] {
  const groups: TupletGroup[] = [];
  let open: (TupletGroup & { written: number; unit: number }) | undefined;
  const close = (): void => {
    if (open) groups.push({ start: open.start, end: open.end, n: open.n, of: open.of });
    open = undefined;
  };
  for (const [i, event] of events.entries()) {
    const { tuplet } = event;
    if (!tuplet) {
      close();
      continue;
    }
    if (open && (open.n !== tuplet.n || open.of !== tuplet.of)) close();
    const written = (WHOLE / event.duration) * (2 - 1 / 2 ** event.dots);
    const unit = WHOLE / event.duration;
    if (open) {
      open.end = i;
      open.written += written;
      open.unit = Math.min(open.unit, unit);
    } else {
      open = { start: i, end: i, n: tuplet.n, of: tuplet.of, written, unit };
    }
    if (open.written + TICK_EPSILON >= open.n * open.unit) close();
  }
  close();
  return groups;
}

/**
 * The beats that share a beam, by index into the voice's events, each group in order. Every beat
 * with a flag or beam is in exactly one group; a group of one takes a flag. Rests and empty beats
 * break beams, tuplets beam within themselves, and everything else beams within the spans of
 * `beamGrouping`.
 */
export function beamGroups(
  events: readonly RhythmEvent[],
  signature: TimeSignature,
  tuplets: readonly TupletGroup[] = tupletGroups(events),
): number[][] {
  const grouping = beamGrouping(signature);
  const tupletOf = new Map<number, number>();
  for (const [g, group] of tuplets.entries()) {
    for (let i = group.start; i <= group.end; i++) tupletOf.set(i, g);
  }

  const runs: number[][] = [];
  let run: number[] = [];
  let key: string | undefined;
  const flush = (): void => {
    if (run.length > 0) runs.push(run);
    run = [];
    key = undefined;
  };
  for (const [i, event] of events.entries()) {
    if (event.silent || beamCount(event.duration) === 0) {
      flush();
      continue;
    }
    const tuplet = tupletOf.get(i);
    const next =
      tuplet === undefined
        ? `span ${String(spanIndex(grouping.eighths, event.tick))}`
        : `tuplet ${String(tuplet)}`;
    if (key !== undefined && key !== next) flush();
    run.push(i);
    key = next;
  }
  flush();

  return runs.flatMap((indices) => {
    const first = indices[0];
    const inTuplet = first !== undefined && tupletOf.has(first);
    const short = indices.some((i) => (events[i]?.duration ?? 8) > 8);
    if (inTuplet || !short) return [indices];
    const split: number[][] = [];
    let last: number | undefined;
    for (const i of indices) {
      const span = spanIndex(grouping.shorter, events[i]?.tick ?? 0);
      const current = split.at(-1);
      if (current && span === last) current.push(i);
      else split.push([i]);
      last = span;
    }
    return split;
  });
}

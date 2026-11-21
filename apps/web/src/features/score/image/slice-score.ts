import {
  beatTicks,
  tieOriginOf,
  type Bar,
  type Clef,
  type Score,
  type TempoMark,
  type Track,
  type Voice,
} from '@reprise/model';

/** `start` and `end` as `sliceScore` uses them: inside the score, at least one bar. */
export function clampRange(
  score: Pick<Score, 'masterBars'>,
  start: number,
  end: number,
): { start: number; end: number } {
  const count = score.masterBars.length;
  const first = Math.max(0, Math.min(start, count - 1));
  return { start: first, end: Math.max(first + 1, Math.min(end, count)) };
}

/**
 * The tempo in effect at the start of bar `index`: the last master-bar mark or beat-level change
 * (`Beat.mix.tempo`, where gp3 to gp5 files keep every change after bar 1) before it, or at its
 * tick 0. Order follows the tempo map: a bar's mark, then its beat changes by tick, and where
 * tracks or voices disagree at one tick the first wins. `duration` is left off: a ramp's target is
 * the tempo once it ends.
 */
function tempoAt(score: Score, index: number): TempoMark | undefined {
  let found: TempoMark | undefined;
  for (let bar = 0; bar <= index; bar++) {
    const mark = score.masterBars[bar]?.tempo;
    if (mark) found = mark;
    const byTick = new Map<number, TempoMark>();
    for (const track of score.tracks) {
      for (const voice of track.bars[bar]?.voices ?? []) {
        let tick = 0;
        for (const beat of voice.beats) {
          const change = beat.mix?.tempo;
          const key = Math.round(tick * 1e6);
          if (change && (bar < index || tick === 0) && !byTick.has(key)) {
            byTick.set(key, {
              bpm: change.bpm,
              ...(change.unit && { unit: change.unit }),
              ...(change.label && { label: change.label }),
            });
          }
          tick += beatTicks(beat);
        }
      }
    }
    const last = [...byTick.entries()].sort(([a], [b]) => a - b).at(-1);
    if (last) found = last[1];
  }
  return found;
}

/**
 * The bars `start` up to `end` (master bar indices, `end` exclusive) as a score of their own, for
 * exporting a bar range. The source is not touched.
 *
 * What a cut-out range loses is put back at its edge: the tempo in effect at the first bar (a score
 * needs one there), each track's clef in effect, and the tie of a note whose origin lies before the
 * range (it would point at nothing). Time and key signatures are on every master bar already.
 *
 * What it does not put back, and the picture shows as the source's own drawing:
 * - A volta cut at the edge stays as it was; `validateScore` reports it as
 *   `alternate-ending-outside-repeat` or `alternate-ending-order`, which an image does not care about.
 * - A repeat end whose start is before the range is drawn as a repeat with no start, and a jump
 *   (D.S., To Coda) whose target is outside the range points nowhere.
 * - `Track.lyrics[].startBar` keeps the source's bar numbers; layout reads `Beat.lyrics`, so
 *   nothing shows wrong, but the slice is not self-consistent there.
 * - Layout writes a dynamic only where it differs from the one before (starting at `f`), so a range
 *   that starts on an `f` after an earlier `p` loses its `f`; one that starts quiet gets its `p`.
 *
 * Bar numbers restart at 1 in the slice. Layout draws a number only on split systems today; if a
 * bar number on every system lands (F048), the slice needs a first-bar-number option.
 */
export function sliceScore(score: Score, start: number, end: number): Score {
  const range = clampRange(score, start, end);
  const masterBars = score.masterBars.slice(range.start, range.end);
  const head = masterBars[0];
  const tempo = tempoAt(score, range.start);
  if (head && tempo) masterBars[0] = { ...head, tempo };
  return {
    ...score,
    masterBars,
    tracks: score.tracks.map((t) => sliceTrack(t, range.start, range.end)),
  };
}

function clefAt(track: Track, index: number): Clef | undefined {
  for (let i = index; i >= 0; i--) {
    const clef = track.bars[i]?.clef;
    if (clef) return clef;
  }
  return undefined;
}

function sliceTrack(track: Track, start: number, end: number): Track {
  const bars = track.bars
    .slice(start, end)
    .map((bar, offset) => untied(track, bar, start + offset, start));
  const head = bars[0];
  if (head && !head.clef) {
    const clef = clefAt(track, start);
    if (clef) bars[0] = { ...head, clef };
  }
  return { ...track, bars };
}

/** A note keeps its tie only when the note it continues is in the range. */
function untied(track: Track, bar: Bar, index: number, start: number): Bar {
  const fix = (voice: Voice, v: number): Voice => {
    if (voice.beats.every((beat) => beat.notes.every((n) => !n.tie))) return voice;
    const beats = voice.beats.map((beat, b) => ({
      ...beat,
      notes: beat.notes.map((n) => {
        if (!n.tie) return n;
        const origin = tieOriginOf(track, { bar: index, voice: v, beat: b }, n);
        return origin && origin.bar >= start ? n : { ...n, tie: false };
      }),
    }));
    return { ...voice, beats };
  };
  const [a, b, c, d] = bar.voices;
  return { ...bar, voices: [fix(a, 0), fix(b, 1), fix(c, 2), fix(d, 3)] };
}

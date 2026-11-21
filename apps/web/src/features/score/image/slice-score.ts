import {
  tieOriginOf,
  type Bar,
  type Clef,
  type Score,
  type Track,
  type Voice,
} from '@reprise/model';

/**
 * The bars `start` up to `end` (master bar indices, `end` exclusive) as a score of their own, for
 * exporting a bar range. The source is not touched.
 *
 * What a cut-out range loses is put back at its edge: the tempo in effect at the first bar (a score
 * needs one there), each track's clef in effect, and the tie of a note whose origin lies before the
 * range (it would point at nothing). Time and key signatures are on every master bar already.
 * A volta cut at the edge stays as it was; `validateScore` reports it as
 * `alternate-ending-outside-repeat`, which an image does not care about.
 *
 * Bar numbers restart at 1 in the slice. Layout draws a number only on split systems today; if a
 * bar number on every system lands (F048), the slice needs a first-bar-number option.
 */
export function sliceScore(score: Score, start: number, end: number): Score {
  const first = Math.max(0, Math.min(start, score.masterBars.length - 1));
  const last = Math.max(first + 1, Math.min(end, score.masterBars.length));
  const masterBars = score.masterBars.slice(first, last);
  const head = masterBars[0];
  if (head && !head.tempo) {
    for (let i = first; i >= 0; i--) {
      const tempo = score.masterBars[i]?.tempo;
      if (!tempo) continue;
      masterBars[0] = { ...head, tempo };
      break;
    }
  }
  return { ...score, masterBars, tracks: score.tracks.map((t) => sliceTrack(t, first, last)) };
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

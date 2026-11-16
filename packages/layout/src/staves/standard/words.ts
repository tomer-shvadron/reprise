import type { StaffBar } from '../staff-module';
import { mainHeads, headEdges } from './chord';
import type { BeatPlan } from './plan';

/**
 * A standard or percussion staff draws a beat's words when it is the track's only staff; in both
 * mode they stay on the tab (ADR-0021).
 */
export function drawsWords(input: StaffBar): boolean {
  return input.staves.length === 1;
}

/**
 * Where a chord name or beat text starts, from the beat's x: the left edge of its heads with the
 * accidentals left out, the rest's left edge, else the onset itself.
 */
export function wordStart(beat: BeatPlan): number {
  const { chord } = beat;
  if (chord) {
    const edges = mainHeads(chord).map((head) => headEdges(chord, head).left);
    return edges.length > 0 ? Math.min(...edges) : 0;
  }
  return beat.rest?.left ?? 0;
}

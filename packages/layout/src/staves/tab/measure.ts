import { glyphMetrics, textWidth } from '../../metrics';
import type { OnsetExtent, StaffBar, StaffBarMeasure } from '../staff-module';
import { DYNAMICS_GLYPHS, beatDynamics } from '../dynamics';
import { analyseEffects } from '../effects';
import { wordsExtent } from '../words';
import { TAB, analyseBar, fingering, type TabBeat, type TabOptions } from './analysis';
import { TICK_EPSILON } from '../../ticks';

/** Where a chord name or beat text starts: at the left edge of the beat's fret numbers. */
export function wordStart(beat: TabBeat): number {
  return -beat.half;
}

function wordsRight(beat: TabBeat, space: number, diagrams: boolean): number {
  let { right } = wordsExtent(beat.beat, wordStart(beat), space, diagrams);
  const dynamics = beatDynamics(beat.beat);
  if (dynamics && beat.dynamicsChange) {
    right = Math.max(
      right,
      (glyphMetrics(DYNAMICS_GLYPHS[dynamics]).advance * TAB.dynamicsScale * space) / 2,
    );
  }
  return right;
}

function wordsLeft(beat: TabBeat, space: number, diagrams: boolean): number {
  let { left } = wordsExtent(beat.beat, wordStart(beat), space, diagrams);
  const dynamics = beatDynamics(beat.beat);
  if (dynamics && beat.dynamicsChange) {
    left = Math.max(
      left,
      (glyphMetrics(DYNAMICS_GLYPHS[dynamics]).advance * TAB.dynamicsScale * space) / 2,
    );
  }
  return left;
}

export function measureTab(input: StaffBar, options: TabOptions): StaffBarMeasure {
  const { space } = input;
  const analysed = analyseBar(input, options);
  const onsets: OnsetExtent[] = [];
  for (const beat of [...analysed.beats].sort((a, b) => a.tick - b.tick)) {
    const left = Math.max(beat.left, wordsLeft(beat, space, input.chordDiagrams));
    const right = Math.max(beat.right, wordsRight(beat, space, input.chordDiagrams));
    const last = onsets.at(-1);
    let half = 0;
    if (analysed.rhythm)
      for (const label of beat.labels) {
        const t = fingering(label.note);
        if (t !== undefined) half = Math.max(half, textWidth(t, TAB.fingerSize * space) / 2);
      }
    if (last && beat.tick - last.tick < TICK_EPSILON) {
      last.left = Math.max(last.left, left);
      last.right = Math.max(last.right, right);
      last.rigid = Math.max(last.rigid ?? 0, beat.right);
      if (half > 0)
        last.marks = {
          left: Math.max(last.marks?.left ?? 0, half),
          right: Math.max(last.marks?.right ?? 0, half),
        };
      if (beat.labelRight) last.ideal = Math.max(last.ideal ?? 0, beat.labelRight);
    } else {
      onsets.push({
        tick: beat.tick,
        left,
        right,
        rigid: beat.right,
        ...(beat.labelRight && { ideal: beat.labelRight }),
        ...(half > 0 && { marks: { left: half, right: half } }),
      });
    }
  }
  const effects = analyseEffects(input.bar, space, { articulations: analysed.rhythm });
  for (const reserved of effects.reserved) {
    const onset = onsets.find((o) => Math.abs(o.tick - reserved.tick) < TICK_EPSILON);
    if (!onset) continue;
    onset.left = Math.max(onset.left, reserved.left);
    onset.right = Math.max(onset.right, reserved.right);
    // Run labels and the like are drawn at their natural width, so a squeezed bar keeps their
    // room, as the standard staff does; a line whose minimums fit never squeezes.
    onset.rigid = Math.max(onset.rigid ?? 0, reserved.right);
  }

  const { rows } = analysed;
  return {
    onsets,
    above: Math.max(rows.upper > 0 ? rows.upper : TAB.wordClearance * space, rows.arcsAbove),
    below: Math.max(rows.lower, rows.arcsBelow),
  };
}

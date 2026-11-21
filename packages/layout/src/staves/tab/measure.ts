import { glyphMetrics } from '../../metrics';
import type { OnsetExtent, StaffBar, StaffBarMeasure } from '../staff-module';
import { DYNAMICS_GLYPHS, beatDynamics } from '../dynamics';
import { analyseEffects } from '../effects';
import { wordsExtent } from '../words';
import { TAB, analyseBar, type TabBeat, type TabOptions } from './analysis';

const TICK_EPSILON = 1e-6;
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
    if (last && beat.tick - last.tick < TICK_EPSILON) {
      last.left = Math.max(last.left, left);
      last.right = Math.max(last.right, right);
    } else {
      onsets.push({ tick: beat.tick, left, right });
    }
  }
  const effects = analyseEffects(input.bar, space, { articulations: analysed.rhythm });
  for (const reserved of effects.reserved) {
    const onset = onsets.find((o) => Math.abs(o.tick - reserved.tick) < TICK_EPSILON);
    if (!onset) continue;
    onset.left = Math.max(onset.left, reserved.left);
    onset.right = Math.max(onset.right, reserved.right);
  }

  const { rows } = analysed;
  return {
    onsets,
    above: Math.max(rows.upper > 0 ? rows.upper : TAB.wordClearance * space, rows.arcsAbove),
    below: Math.max(rows.lower, rows.arcsBelow),
  };
}

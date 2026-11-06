import { glyphMetrics, textWidth } from '../../metrics';
import type { OnsetExtent, StaffBar, StaffBarMeasure } from '../staff-module';
import { DYNAMICS_GLYPHS, beatDynamics } from '../dynamics';
import { analyseEffects } from '../effects';
import { TAB, analyseBar, type TabBeat, type TabOptions } from './analysis';
import { feelRight } from './spacing';

const TICK_EPSILON = 1e-6;
/** Room between a beat's words and the next onset's, in staff spaces. */
const WORD_GAP = 0.4;

/** Where a chord name or beat text starts: at the left edge of the beat's fret numbers. */
export function wordStart(beat: TabBeat): number {
  return -beat.half;
}

function wordsRight(beat: TabBeat, space: number): number {
  const { chord, text, lyrics } = beat.beat;
  const gap = WORD_GAP * space;
  let right = 0;
  if (chord)
    right = Math.max(right, wordStart(beat) + textWidth(chord.name, TAB.textSize * space) + gap);
  if (text) right = Math.max(right, wordStart(beat) + textWidth(text, TAB.textSize * space) + gap);
  for (const syllable of lyrics ?? [])
    right = Math.max(right, textWidth(syllable, TAB.textSize * space) / 2 + gap);
  const dynamics = beatDynamics(beat.beat);
  if (dynamics && beat.dynamicsChange) {
    right = Math.max(
      right,
      (glyphMetrics(DYNAMICS_GLYPHS[dynamics]).advance * TAB.dynamicsScale * space) / 2,
    );
  }
  return right;
}

function wordsLeft(beat: TabBeat, space: number): number {
  let left = 0;
  for (const syllable of beat.beat.lyrics ?? []) {
    left = Math.max(left, textWidth(syllable, TAB.textSize * space) / 2 + WORD_GAP * space);
  }
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
    const left = Math.max(beat.left, wordsLeft(beat, space));
    const right = Math.max(beat.right, wordsRight(beat, space));
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
  const nextLeft = (tick: number): number =>
    onsets.find((onset) => Math.abs(onset.tick - tick) < TICK_EPSILON)?.left ?? 0;
  for (const onset of onsets) {
    onset.right = Math.max(
      onset.right,
      feelRight(input.score, input.barIndex, onset.tick, nextLeft, space),
    );
  }

  const { rows } = analysed;
  return {
    onsets,
    above: Math.max(rows.upper > 0 ? rows.upper : TAB.wordClearance * space, rows.lettersAbove),
    below: Math.max(rows.lower, rows.lettersBelow),
  };
}

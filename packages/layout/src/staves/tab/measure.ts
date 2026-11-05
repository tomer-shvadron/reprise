import { glyphMetrics, textWidth } from '../../metrics';
import type { OnsetExtent, StaffBar, StaffBarMeasure } from '../staff-module';
import {
  DYNAMICS_GLYPHS,
  TAB,
  analyseBar,
  beatDynamics,
  type TabBeat,
  type TabOptions,
  type TabRows,
} from './analysis';
import { feelRight } from './spacing';

const TICK_EPSILON = 1e-6;
/** Room between a beat's words and the next onset's, in staff spaces. */
const WORD_GAP = 0.4;

/** The bottom of the word rows above the staff, up from the top string, in px. */
export function wordsBase(rows: TabRows): number {
  const words = rows.fingering + rows.chord + rows.text;
  return rows.upper + (words > 0 ? rows.clearance : 0);
}

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
    above: Math.max(
      TAB.minAbove * space,
      wordsBase(rows) + rows.fingering + rows.chord + rows.text,
    ),
    below: rows.lower + rows.lyrics,
  };
}

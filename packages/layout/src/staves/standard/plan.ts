import {
  PPQ,
  beatTicks,
  type Beat,
  type Duration,
  type Dynamics,
  type Finger,
  type Note,
} from '@reprise/model';

import { glyphMetrics, type GlyphName } from '../../metrics';
import { glyphWidth } from '../../primitives';
import type { StaffBar } from '../staff-module';
import { planChord, positionY, type ChordNote, type ChordPlan } from './chord';
import { shownDynamics } from './dynamics';
import { barAccidentals, placeNote, type ShownAccidental } from './pitch';
import {
  beamCount,
  beamGroups,
  beamLine,
  dotsWidth,
  tieReach,
  tupletReach,
  type BeamLine,
  type StemDirection,
} from './rhythm';

/** Options a notation staff is created with. */
export interface NotationOptions {
  /** Read note positions and heads from the GM percussion map instead of spelling pitches. */
  percussion: boolean;
  /** Repeat, in parentheses, an accidental the previous bar printed when the bar line cancels it. */
  courtesyAccidentals: boolean;
}

/** Grace notes are drawn at this share of the normal size. */
export const GRACE_SCALE = 0.6;
const GRACE_GAP = 0.3;
const GRACE_STEP = 0.2;
/** Room every bar keeps above and below the staff, in staff spaces. */
const MIN_ROOM = 1.5;
const MARGIN = 0.3;
const FINGERING_GAP = 0.4;
const FINGERING_STEP = 1.1;
const DYNAMICS_GAP = 1.2;

export interface GracePlan {
  /** The grace chord's x, from the beat's. */
  offset: number;
  chord: ChordPlan;
  /** A single grace note is an eighth with a slash; several are beamed by their value. */
  slash: boolean;
}

export interface RestPlan {
  glyph: GlyphName;
  y: number;
  left: number;
  width: number;
  /** Alone in its voice: centred in the bar rather than at its onset. */
  centred: boolean;
  dots: { x: number; y: number };
}

export interface BeatPlan {
  beat: Beat;
  voice: number;
  /** Index of the beat in its voice. */
  index: number;
  tick: number;
  chord?: ChordPlan;
  rest?: RestPlan;
  graces: GracePlan[];
  /** The graces' beam, from the beat's x, when there are several. */
  graceBeam?: BeamLine;
  group?: number;
  tuplet?: number;
  dynamics?: { value: Dynamics; note: Note };
  /** Fingering, top to bottom. */
  fingering: { glyph: GlyphName; note: Note }[];
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface GroupPlan {
  beats: BeatPlan[];
  direction: StemDirection;
}

export interface TupletPlan {
  beats: BeatPlan[];
  n: number;
  above: boolean;
  bracket: boolean;
}

export interface BarPlan {
  beats: BeatPlan[];
  /** Beats per voice, in order. */
  voices: BeatPlan[][];
  groups: GroupPlan[];
  tuplets: TupletPlan[];
  multiVoice: boolean;
  /** Content bounds from the top line, before fingering and dynamics, the beams at their furthest. */
  top: number;
  bottom: number;
  /** Bottom of the fingering stack and baseline of the dynamics. */
  fingeringY: number;
  dynamicsY: number;
  above: number;
  below: number;
}

const REST_GLYPHS: Record<Duration, GlyphName> = {
  1: 'restWhole',
  2: 'restHalf',
  4: 'restQuarter',
  8: 'rest8th',
  16: 'rest16th',
  32: 'rest32nd',
  64: 'rest64th',
  128: 'rest128th',
  256: 'rest256th',
};

const LEFT_HAND: Record<Finger, GlyphName> = {
  thumb: 'fingeringTUpper',
  index: 'fingering1',
  middle: 'fingering2',
  ring: 'fingering3',
  little: 'fingering4',
};
const RIGHT_HAND: Record<Finger, GlyphName> = {
  thumb: 'fingeringPLower',
  index: 'fingeringILower',
  middle: 'fingeringMLower',
  ring: 'fingeringALower',
  little: 'fingeringCLower',
};

/** Voices 1 and 3 stem up, 2 and 4 down, when a staff carries more than one. */
export function voiceDirection(voice: number): StemDirection {
  return voice % 2 === 0 ? 'up' : 'down';
}

function hasContent(beat: Beat): boolean {
  return beat.rest || beat.notes.length > 0;
}

/** Up when the note furthest from the middle line is below it; a tie goes down. */
function directionByPosition(positions: readonly number[]): StemDirection {
  if (positions.length === 0) return 'up';
  const above = Math.max(...positions) - 4;
  const below = 4 - Math.min(...positions);
  return below > above ? 'up' : 'down';
}

/** The values a tuplet of unequal beats closes on, in ticks: a half note down to a 256th. */
const PLAIN_VALUES = [2, 4, 8, 16, 32, 64, 128, 256].map((duration) => (PPQ * 4) / duration);
const TICK_EPSILON = 1e-6;

/**
 * Each beat's tuplet run, grouped as alphaTab groups them so brackets match Guitar Pro's:
 * consecutive beats of one ratio, closed after `n` beats of one value, or once beats of unequal
 * values add up to a plain note value (a quarter-and-eighth triplet is one group, the quarter
 * triplets after it another).
 */
function tupletRuns(beats: readonly Beat[]): (number | undefined)[] {
  const runs: (number | undefined)[] = [];
  let run = -1;
  let open = false;
  let ratio = '';
  let count = 0;
  let filled = 0;
  let first = 0;
  let equal = true;
  for (const beat of beats) {
    const { tuplet } = beat;
    if (!tuplet) {
      runs.push(undefined);
      open = false;
      continue;
    }
    const key = `${String(tuplet.n)}:${String(tuplet.of)}`;
    const ticks = beatTicks(beat);
    if (!open || key !== ratio) {
      run += 1;
      open = true;
      ratio = key;
      count = 0;
      filled = 0;
      first = ticks;
      equal = true;
    }
    count += 1;
    filled += ticks;
    if (Math.abs(ticks - first) > TICK_EPSILON) equal = false;
    runs.push(run);
    const factor = Math.max(1, Math.floor(tuplet.n / tuplet.of));
    const full = equal
      ? count === tuplet.n
      : PLAIN_VALUES.some((value) => Math.abs(filled - value * factor) < TICK_EPSILON);
    if (full) open = false;
  }
  return runs;
}

function restPlan(
  beat: Beat,
  voice: number,
  multiVoice: boolean,
  alone: boolean,
  space: number,
): RestPlan {
  const glyph = REST_GLYPHS[beat.duration];
  let position = beat.duration === 1 ? 6 : 4;
  if (multiVoice) {
    if (voiceDirection(voice) === 'up') position = beat.duration === 2 ? 6 : 8;
    else position = beat.duration === 1 ? 2 : 0;
  }
  const { left, right } = glyphMetrics(glyph).bbox;
  const width = (right - left) * space;
  const dotRow = position % 2 === 0 ? position + 1 : position;
  return {
    glyph,
    y: positionY(position, space),
    left: -width / 2,
    width,
    centred: alone && beat.duration <= 1,
    dots: { x: width / 2, y: positionY(dotRow, space) },
  };
}

function restBounds(rest: RestPlan, space: number): { top: number; bottom: number } {
  const { top, bottom } = glyphMetrics(rest.glyph).bbox;
  return { top: rest.y - top * space, bottom: rest.y - bottom * space };
}

/** The note a tie continues: the same string on a fretted track, the same pitch elsewhere. */
export function noteMatches(a: Note, b: Note, fretted: boolean): boolean {
  return fretted ? a.string === b.string : a.fret === b.fret;
}

/**
 * Everything about a bar that does not depend on where its onsets land: heads, accidentals,
 * stems, rests, graces, beam groups with their beams at the furthest they can reach, tuplets,
 * fingering and dynamics, all from each onset's x and the staff's top line. `measure` reads its
 * extents; `render` places it.
 */
export function planBar(input: StaffBar, options: NotationOptions): BarPlan {
  const { track, bar, space } = input;
  const key = input.keySignature;
  const percussion = options.percussion;
  const previousBar = input.barIndex > 0 ? track.bars[input.barIndex - 1] : undefined;
  const previousKey = input.score.masterBars[input.barIndex - 1]?.keySignature;
  const accidentals = percussion
    ? new Map<string, ShownAccidental>()
    : barAccidentals(
        track,
        bar,
        key,
        options.courtesyAccidentals && previousBar && previousKey
          ? { bar: previousBar, key: previousKey }
          : undefined,
      );
  const multiVoice = bar.voices.filter((voice) => voice.beats.some(hasContent)).length > 1;
  const middle = positionY(4, space);
  const time = input.masterBar.timeSignature;

  const chordNotes = (notes: readonly Note[]): ChordNote[] =>
    notes.map((note) => {
      const placed = placeNote(track, note, key, input.clef, percussion);
      const accidental = accidentals.get(note.id);
      return { note, ...placed, ...(accidental && { accidental }) };
    });

  const beats: BeatPlan[] = [];
  const voices: BeatPlan[][] = [];
  const groups: GroupPlan[] = [];
  const tuplets: TupletPlan[] = [];
  const dynamics = shownDynamics(track, input.barIndex);

  for (const [voice, { beats: voiceBeats }] of bar.voices.entries()) {
    const notes = voiceBeats.map((beat) => chordNotes(beat.notes));
    const runs = tupletRuns(voiceBeats);
    const ticks: number[] = [];
    let tick = 0;
    for (const beat of voiceBeats) {
      ticks.push(tick);
      tick += beatTicks(beat);
    }
    const grouped = beamGroups(
      voiceBeats.map((beat, i) => {
        const run = runs[i];
        return {
          tick: ticks[i] ?? 0,
          beamable: !beat.rest && beat.notes.length > 0 && beamCount(beat.duration) > 0,
          ...(run !== undefined && { tuplet: run }),
        };
      }),
      time,
    );
    const groupOf = new Map<number, number>();
    const directions = voiceBeats.map((beat, i): StemDirection => {
      if (multiVoice) return voiceDirection(voice);
      if (percussion) return 'up';
      return directionByPosition((notes[i] ?? []).map(({ position }) => position));
    });
    for (const [g, members] of grouped.entries()) {
      const direction = multiVoice
        ? voiceDirection(voice)
        : percussion
          ? 'up'
          : directionByPosition(
              members.flatMap((i) => (notes[i] ?? []).map(({ position }) => position)),
            );
      for (const i of members) {
        groupOf.set(i, groups.length + g);
        directions[i] = direction;
      }
    }

    const alone = voiceBeats.length === 1;
    const planned = voiceBeats.map((beat, index): BeatPlan => {
      const direction = directions[index] ?? 'up';
      const group = groupOf.get(index);
      const run = runs[index];
      const plan: BeatPlan = {
        beat,
        voice,
        index,
        tick: ticks[index] ?? 0,
        graces: [],
        fingering: [],
        left: -space / 2,
        right: space / 2,
        top: middle,
        bottom: middle,
        ...(group !== undefined && { group }),
        ...(run !== undefined && { tuplet: run }),
      };
      if (beat.rest) {
        const rest = restPlan(beat, voice, multiVoice, alone, space);
        plan.rest = rest;
        plan.left = rest.left;
        plan.right = rest.dots.x + dotsWidth(beat.dots, space);
        ({ top: plan.top, bottom: plan.bottom } = restBounds(rest, space));
        return plan;
      }
      const chord = notes[index] ?? [];
      if (chord.length === 0) return plan;
      const planned = planChord(chord, {
        duration: beat.duration,
        dots: beat.dots,
        direction,
        space,
        scale: 1,
        multiVoice,
        reachMiddle: true,
      });
      plan.chord = planned;
      plan.left = planned.left;
      plan.right = planned.right;
      plan.top = planned.top;
      plan.bottom = planned.bottom;
      const tied = planned.heads.some(({ note }) => note.tie) || index === voiceBeats.length - 1;
      if (tied) {
        plan.top = Math.min(plan.top, ...planned.heads.map(({ y }) => y - tieReach(space)));
        plan.bottom = Math.max(plan.bottom, ...planned.heads.map(({ y }) => y + tieReach(space)));
      }
      planGraces(plan, chordNotes, space, multiVoice);
      if (!percussion) {
        for (const head of [...planned.heads].reverse()) {
          const { leftHandFinger, rightHandFinger } = head.note;
          if (rightHandFinger)
            plan.fingering.push({ glyph: RIGHT_HAND[rightHandFinger], note: head.note });
          if (leftHandFinger)
            plan.fingering.push({ glyph: LEFT_HAND[leftHandFinger], note: head.note });
        }
      }
      const shown = dynamics.get(beat.id);
      if (shown) plan.dynamics = shown;
      return plan;
    });

    for (const members of grouped) {
      const groupBeats = members.flatMap((i) => planned[i] ?? []);
      const direction = groupBeats[0]?.chord?.direction ?? 'up';
      const stems = groupBeats.flatMap(({ chord }) =>
        chord?.stem ? [{ x: chord.stem.x, head: chord.stem.head, beams: chord.beams }] : [],
      );
      const line = beamLine(stems, direction, { space, middle, exact: false });
      const reach =
        direction === 'up' ? Math.min(line.start, line.end) : Math.max(line.start, line.end);
      for (const beat of groupBeats) {
        if (direction === 'up') beat.top = Math.min(beat.top, reach);
        else beat.bottom = Math.max(beat.bottom, reach);
      }
      groups.push({ beats: groupBeats, direction });
    }

    const byRun = new Map<number, BeatPlan[]>();
    for (const plan of planned) {
      if (plan.tuplet === undefined) continue;
      const members = byRun.get(plan.tuplet);
      if (members) members.push(plan);
      else byRun.set(plan.tuplet, [plan]);
    }
    for (const members of byRun.values()) {
      const first = members[0];
      const n = first?.beat.tuplet?.n;
      if (!first || n === undefined) continue;
      const withNotes = members.find(({ chord }) => chord);
      const above = (withNotes?.chord?.direction ?? 'up') === 'up';
      const group = first.group;
      const oneGroup =
        group !== undefined &&
        members.every((member) => member.group === group) &&
        groups[group]?.beats.length === members.length;
      const top = Math.min(...members.map((member) => member.top)) - tupletReach(space);
      const bottom = Math.max(...members.map((member) => member.bottom)) + tupletReach(space);
      for (const member of members) {
        if (above) member.top = top;
        else member.bottom = bottom;
      }
      tuplets.push({ beats: members, n, above, bracket: !oneGroup });
    }

    beats.push(...planned);
    voices.push(planned);
  }

  let top = 0;
  let bottom = positionY(0, space);
  for (const beat of beats) {
    top = Math.min(top, beat.top);
    bottom = Math.max(bottom, beat.bottom);
  }
  const fingers = Math.max(0, ...beats.map(({ fingering }) => fingering.length));
  const fingeringY = top - FINGERING_GAP * space;
  const fingeringTop = fingers > 0 ? fingeringY - fingers * FINGERING_STEP * space : top;
  const hasDynamics = beats.some(({ dynamics: shown }) => shown);
  const dynamicsY = bottom + DYNAMICS_GAP * space + glyphMetrics('dynamicForte').bbox.top * space;
  const dynamicsBottom = hasDynamics
    ? dynamicsY - glyphMetrics('dynamicForte').bbox.bottom * space
    : bottom;
  return {
    beats,
    voices,
    groups,
    tuplets,
    multiVoice,
    top,
    bottom,
    fingeringY,
    dynamicsY,
    above: Math.max(MIN_ROOM * space, -fingeringTop + MARGIN * space),
    below: Math.max(MIN_ROOM * space, dynamicsBottom - positionY(0, space) + MARGIN * space),
  };
}

function planGraces(
  plan: BeatPlan,
  chordNotes: (notes: readonly Note[]) => ChordNote[],
  space: number,
  multiVoice: boolean,
): void {
  const graces = plan.beat.grace ?? [];
  if (graces.length === 0 || !plan.chord) return;
  const single = graces.length === 1;
  const chords = graces.map((grace) =>
    planChord(chordNotes(grace.notes), {
      duration: 8,
      dots: 0,
      direction: 'up',
      space,
      scale: GRACE_SCALE,
      multiVoice,
      beams: single ? 1 : beamCount(grace.duration),
      reachMiddle: false,
    }),
  );
  let cursor = plan.left - GRACE_GAP * space;
  const placed: GracePlan[] = [];
  for (let g = chords.length - 1; g >= 0; g--) {
    const chord = chords[g];
    if (!chord) continue;
    const offset = cursor - chord.right;
    placed.unshift({ offset, chord, slash: single });
    cursor = offset + chord.left - GRACE_STEP * space;
    plan.top = Math.min(plan.top, chord.top);
    plan.bottom = Math.max(plan.bottom, chord.bottom);
  }
  plan.graces = placed;
  plan.left = Math.min(plan.left, cursor);
  if (!single) {
    const stems = placed.flatMap(({ offset, chord }) =>
      chord.stem ? [{ x: offset + chord.stem.x, head: chord.stem.head, beams: chord.beams }] : [],
    );
    const line = beamLine(stems, 'up', { space, scale: GRACE_SCALE, exact: true });
    plan.graceBeam = line;
    plan.top = Math.min(plan.top, line.start, line.end);
  }
}

/** Width of `glyphs` set side by side. */
export function glyphsWidth(glyphs: readonly GlyphName[], space: number): number {
  return glyphs.reduce((sum, name) => sum + glyphWidth(name, space), 0);
}

import { beatTicks, type Beat, type Duration, type Finger, type Note } from '@reprise/model';

import { glyphMetrics, type GlyphName } from '../../metrics';
import { glyphWidth } from '../../primitives';
import type { StaffBar } from '../staff-module';
import {
  headEdges,
  mainHeads,
  planChord,
  positionY,
  tieDirection,
  type ChordNote,
  type ChordPlan,
} from './chord';
import {
  articulationHalf,
  articulationReach,
  SLIDE,
  STROKE,
  beamedShortfall,
  nearOrigin,
  planArticulation,
  planTremolo,
  type ArticulationPlan,
  type TremoloPlan,
} from './effects';
import {
  barAccidentals,
  harmonicHead,
  placeNote,
  soundingKey,
  type ShownAccidental,
} from './pitch';
import { beamCount, beamGroups, tupletGroups, type RhythmEvent } from '../rhythm';
import { BEND_ROOM, letterReach } from '../effects';
import {
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
export const MIN_ROOM = 1.5;
const MARGIN = 0.3;
const FINGERING_GAP = 0.4;
const FINGERING_STEP = 1.1;

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
  /** Fingering, top to bottom. */
  fingering: { glyph: GlyphName; note: Note }[];
  articulation?: ArticulationPlan;
  tremolo?: TremoloPlan;
  /** The arpeggio or brush column's centre, from the beat's x. */
  strokeX?: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface GroupPlan {
  beats: BeatPlan[];
  direction: StemDirection;
  /** How far the beam moves out for its stems' tremolo strokes, in px. */
  extend: number;
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
  /** Content bounds from the top line, before fingering, the beams at their furthest. */
  top: number;
  bottom: number;
  /** Bottom of the fingering stack. */
  fingeringY: number;
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
 * stems, rests, graces, beam groups with their beams at the furthest they can reach, tuplets and
 * fingering, all from each onset's x and the staff's top line. `measure` reads its
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
  // The track's only staff: it also carries what both mode leaves to the tab.
  const lone = input.staves.length === 1;
  const middle = positionY(4, space);
  const time = input.masterBar.timeSignature;

  const chordNotes = (notes: readonly Note[]): ChordNote[] =>
    notes.flatMap((note) => {
      const placed = placeNote(track, note, key, input.clef, percussion);
      const accidental = accidentals.get(note.id);
      const main: ChordNote = { note, ...placed, ...(accidental && { accidental }) };
      const diamond = percussion ? undefined : harmonicHead(track, note, key, input.clef);
      if (!diamond) return [main];
      const shown = accidentals.get(soundingKey(note.id));
      return [main, { note, ...diamond, sounding: true, ...(shown && { accidental: shown }) }];
    });
  // A harmonic's sounding diamond never turns its stem.
  const mainPositions = (chord: readonly ChordNote[]): number[] =>
    chord.flatMap(({ position, sounding }) => (sounding ? [] : [position]));

  const beats: BeatPlan[] = [];
  const voices: BeatPlan[][] = [];
  const groups: GroupPlan[] = [];
  const tuplets: TupletPlan[] = [];

  for (const [voice, { beats: voiceBeats }] of bar.voices.entries()) {
    const notes = voiceBeats.map((beat) => chordNotes(beat.notes));
    const ticks: number[] = [];
    let tick = 0;
    for (const beat of voiceBeats) {
      ticks.push(tick);
      tick += beatTicks(beat);
    }
    const events = voiceBeats.map((beat, i): RhythmEvent => ({
      tick: ticks[i] ?? 0,
      ticks: beatTicks(beat),
      duration: beat.duration,
      dots: beat.dots,
      ...(beat.tuplet && { tuplet: beat.tuplet }),
      silent: beat.rest || beat.notes.length === 0,
    }));
    const tupletList = tupletGroups(events);
    const runs: (number | undefined)[] = voiceBeats.map(() => undefined);
    for (const [g, group] of tupletList.entries()) {
      for (let i = group.start; i <= group.end; i++) runs[i] = g;
    }
    // A group of one takes a flag, which the chord plan draws by itself.
    const grouped = beamGroups(events, time, tupletList).filter((members) => members.length > 1);
    const groupOf = new Map<number, number>();
    const directions = voiceBeats.map((beat, i): StemDirection => {
      if (multiVoice) return voiceDirection(voice);
      if (percussion) return 'up';
      return directionByPosition(mainPositions(notes[i] ?? []));
    });
    for (const [g, members] of grouped.entries()) {
      const direction = multiVoice
        ? voiceDirection(voice)
        : percussion
          ? 'up'
          : directionByPosition(members.flatMap((i) => mainPositions(notes[i] ?? [])));
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
      const tremolo = planTremolo(beat, planned, group !== undefined, space);
      if (tremolo) plan.tremolo = tremolo;
      plan.left = planned.left;
      plan.right = planned.right;
      plan.top = planned.top;
      plan.bottom = planned.bottom;
      const heads = mainHeads(planned);
      const tied = heads.some(({ note }) => note.tie) || index === voiceBeats.length - 1;
      if (tied) {
        plan.top = Math.min(plan.top, ...heads.map(({ y }) => y - tieReach(space)));
        plan.bottom = Math.max(plan.bottom, ...heads.map(({ y }) => y + tieReach(space)));
      }
      if (!percussion) planBeside(plan, beat, heads, lone, space);
      if (
        lone &&
        !percussion &&
        heads.some(({ note }) => note.bend && note.bend.kind !== 'prebend')
      ) {
        const right = Math.max(...heads.map((head) => headEdges(planned, head).right));
        plan.right = Math.max(plan.right, right + BEND_ROOM.main * space);
      }
      planGraces(plan, chordNotes, space, multiVoice, lone && !percussion);
      if (!percussion) {
        for (const head of [...heads].reverse()) {
          const { leftHandFinger, rightHandFinger } = head.note;
          if (rightHandFinger)
            plan.fingering.push({ glyph: RIGHT_HAND[rightHandFinger], note: head.note });
          if (leftHandFinger)
            plan.fingering.push({ glyph: LEFT_HAND[leftHandFinger], note: head.note });
        }
      }
      return plan;
    });

    if (track.kind === 'fretted' && !percussion) {
      for (const plan of planned) planSlurs(plan, planned, input, voice, multiVoice, lone);
    }

    for (const members of grouped) {
      const groupBeats = members.flatMap((i) => planned[i] ?? []);
      const direction = groupBeats[0]?.chord?.direction ?? 'up';
      const stems = groupBeats.flatMap(({ chord }) =>
        chord?.stem ? [{ x: chord.stem.x, head: chord.stem.head, beams: chord.beams }] : [],
      );
      const extend = Math.max(
        0,
        ...groupBeats.map(({ tremolo, chord }) =>
          tremolo && chord ? beamedShortfall(tremolo, chord, space) : 0,
        ),
      );
      const line = beamLine(stems, direction, { space, middle, exact: false, extend });
      const reach =
        direction === 'up' ? Math.min(line.start, line.end) : Math.max(line.start, line.end);
      for (const beat of groupBeats) {
        if (direction === 'up') beat.top = Math.min(beat.top, reach);
        else beat.bottom = Math.max(beat.bottom, reach);
      }
      groups.push({ beats: groupBeats, direction, extend });
    }

    for (const plan of planned) {
      const { chord } = plan;
      if (!chord) continue;
      const articulation = planArticulation(plan.beat, chord, multiVoice || percussion, space);
      if (!articulation) continue;
      plan.articulation = articulation;
      // Beyond a stem, the beat's extent already holds the furthest its tip or beam reaches.
      const edge =
        articulation.stemSide && chord.stem
          ? articulation.above
            ? plan.top
            : plan.bottom
          : articulation.edge;
      const far = articulationReach(articulation, edge, space);
      if (articulation.above) plan.top = Math.min(plan.top, far);
      else plan.bottom = Math.max(plan.bottom, far);
      const half = articulationHalf(articulation, space);
      plan.left = Math.min(plan.left, articulation.x - half);
      plan.right = Math.max(plan.right, articulation.x + half);
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
  return {
    beats,
    voices,
    groups,
    tuplets,
    multiVoice,
    top,
    bottom,
    fingeringY,
    above: -fingeringTop + MARGIN * space,
    below: bottom - positionY(0, space) + MARGIN * space,
  };
}

/** Room left of the chord for a slide into it and a stroke arrow, and right for a slide out. */
function planBeside(
  plan: BeatPlan,
  beat: Beat,
  heads: readonly { y: number }[],
  lone: boolean,
  space: number,
): void {
  const slides = beat.notes.flatMap((note) => note.slide ?? []);
  if (slides.some((kind) => kind === 'intoFromBelow' || kind === 'intoFromAbove')) {
    plan.left -= SLIDE.room * space;
  }
  if (slides.some((kind) => kind === 'outDown' || kind === 'outUp')) {
    plan.right += SLIDE.room * space;
  }
  // In both mode the tab draws the brush; an arpeggio's wave belongs beside the heads.
  const { arpeggio, brush } = beat.effects;
  if (!arpeggio && !(brush && lone)) return;
  plan.strokeX = plan.left - (STROKE.width * space) / 2;
  plan.left -= STROKE.width * space;
  const ys = heads.map(({ y }) => y);
  plan.top = Math.min(plan.top, Math.min(...ys) - STROKE.reach * space);
  plan.bottom = Math.max(plan.bottom, Math.max(...ys) + STROKE.reach * space);
}

/**
 * Room for the slurs of hammer-ons and legato slides ending at the beat: past the higher or
 * lower of its two heads when the origin is in this bar or the one before, past the target
 * alone when the slur arrives as a half, and for the letter over it when the staff is alone.
 */
function planSlurs(
  plan: BeatPlan,
  planned: readonly BeatPlan[],
  input: StaffBar,
  voice: number,
  multiVoice: boolean,
  lone: boolean,
): void {
  const { chord } = plan;
  if (!chord) return;
  const { track, space } = input;
  const reach = tieReach(space) + (lone ? letterReach(space) : 0);
  const lastGrace = plan.graces.at(-1);
  for (const head of mainHeads(chord)) {
    const { note } = head;
    const grace = lastGrace?.chord.heads.find(
      (other) => !other.sounding && other.note.string === note.string,
    );
    let ys = [head.y];
    let direction = tieDirection(chord, head, multiVoice);
    if (grace) {
      if (!note.hammerPull && !grace.note.slide?.includes('legato')) continue;
      ys = [head.y, grace.y];
      direction = 'down';
    } else {
      const origin = nearOrigin(track, input.barIndex, voice, plan.index, note);
      const legato = origin?.note.slide?.includes('legato') ?? false;
      if (!note.hammerPull && !legato) continue;
      if (origin?.bar === input.barIndex) {
        const from = planned[origin.beat]?.chord?.heads.find(
          (other) => !other.sounding && other.note === origin.note,
        );
        if (from) ys.push(from.y);
      } else if (origin && input.bar.clef === undefined) {
        const key = input.score.masterBars[input.barIndex - 1]?.keySignature;
        if (key) {
          const placed = placeNote(track, origin.note, key, input.clef, false);
          ys.push(positionY(placed.position, space));
        }
      }
    }
    if (direction === 'up') plan.top = Math.min(plan.top, Math.min(...ys) - reach);
    else plan.bottom = Math.max(plan.bottom, Math.max(...ys) + reach);
  }
}

function planGraces(
  plan: BeatPlan,
  chordNotes: (notes: readonly Note[]) => ChordNote[],
  space: number,
  multiVoice: boolean,
  bends: boolean,
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
    // A grace note's bend, drawn when the staff is alone, keeps room before what follows it.
    const bent = bends && (graces[g]?.notes.some((note) => note.bend) ?? false);
    const offset = cursor - chord.right - (bent ? BEND_ROOM.grace * space : 0);
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

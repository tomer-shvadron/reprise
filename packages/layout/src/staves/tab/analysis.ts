import { beatTicks, type Bar, type Beat, type Finger, type Note, type Voice } from '@reprise/model';

import { glyphMetrics, textExtent, textWidth, type GlyphName } from '../../metrics';
import type { TiedNotes } from '../../types';
import {
  BEAM_PITCH,
  TIE_MAX_HEIGHT,
  beamCount,
  beamGroups,
  dotsWidth,
  flagWidth,
  tupletGroups,
  type RhythmEvent,
  type StemDirection,
  type TupletGroup,
} from '../rhythm';
import { reservedDynamics } from '../dynamics';
import {
  BEND_ROOM,
  KNOCKOUT,
  LETTER,
  naturalHarmonicText,
  suffixText,
  tremoloGlyph,
} from '../effects';
import type { StaffBar } from '../staff-module';

/** Every size and distance of the tab staff, in staff spaces. */
export const TAB = {
  lineSpacing: 1.5,
  fretSize: 1.3,
  /** Paper kept around a fret number so the string line stops short of it, in ems of the number. */
  knockoutX: KNOCKOUT.x,
  knockoutY: KNOCKOUT.y,
  graceScale: 0.7,
  graceGap: 0.25,
  /** From the outer string to where stems start, and a stem's length to its beam or flag. */
  stemGap: 0.75,
  stem: 3.25,
  /** A half note's stem is the outer part of a quarter's, as Guitar Pro draws it. */
  halfStemSkip: 1.75,
  graceStem: 2,
  dotX: 0.45,
  dotY: 0.6,
  /** From the beams to the line tuplet numbers and dynamics are centred on. */
  tupletGap: 1.45,
  /** Below the beams: the row of tuplet numbers and dynamics, and a margin. */
  tupletRoom: 2.65,
  textSize: 1.2,
  chordRow: 2.2,
  textRow: 2,
  fingerSize: 1,
  fingerRow: 1.1,
  lyricRow: 2,
  dynamicsScale: 0.8,
  /** Room kept above the top string when nothing is drawn there; a repeat count sits in it. */
  minAbove: 2,
  /** How far a beat's hit box reaches past the staff on a side without rhythm notation. */
  beatReach: 1,
  /** Where words above the staff start when no upper voice is drawn: clear of the fret numbers. */
  wordClearance: 0.75,
  restSpacing: 0.3,
  /** From a number's knockout to its suffix's, in ems of the number. */
  suffixGap: 0.12,
  /** Room for an arpeggio or brush arrow left of a beat, for a slide into or out of a note, and right of a bend. */
  strokeRoom: 1,
  slideRoom: 1.5,
  bendRoom: BEND_ROOM.main,
  /** Room right of a grace column holding a bend, so its arrow stays clear of the main number. */
  graceBendRoom: BEND_ROOM.grace,
  /** Free stem kept between the strings and tremolo strokes, and around the strokes, in staff spaces. */
  tremoloGap: 0.5,
  tremoloRoom: 1,
  /** A hammer-on's letter: its size, and its gap from the arc, in staff spaces. */
  letterSize: LETTER.size,
  letterGap: LETTER.gap,
} as const;

export interface NoteLabel {
  note: Note;
  /** The text on the string; `undefined` for a tied note when tied notes are hidden. */
  text: string | undefined;
  /** Width of the text, or of the fret number it stands for when hidden, in px. */
  width: number;
  /** A harmonic's sounding fret or a trill's other fret, small after the number. */
  suffix?: { text: string; width: number };
}

export interface GraceColumn {
  duration: 16 | 32 | 64;
  labels: NoteLabel[];
  /** Widest label, in px. */
  width: number;
  /** Room kept right of the column for a bend, in px. */
  room: number;
}

export interface TabBeat {
  voice: number;
  index: number;
  beat: Beat;
  tick: number;
  event: RhythmEvent;
  direction: StemDirection;
  labels: NoteLabel[];
  graces: GraceColumn[];
  /** Half the widest fret number with its knockout, or half the rest glyph, in px. */
  half: number;
  /** Room the beat's own drawing takes either side of its onset, in px. */
  left: number;
  right: number;
  /** Room for an arpeggio or brush arrow left of the numbers, in px; zero without one. */
  stroke: number;
  /** Whether a note or grace note of the beat bends, slides or is hammered on. */
  connects: boolean;
  /** Whether measure keeps room for the beat's dynamic: `reservedDynamics` holds it. */
  dynamicsChange: boolean;
}

export interface TabVoice {
  index: number;
  direction: StemDirection;
  beats: TabBeat[];
  beams: number[][];
  tuplets: TupletGroup[];
  /** How far stems reach past the standard length for their beams and tremolo strokes, in px. */
  extraStem: number;
  /** The part of `extraStem` that makes room for tremolo strokes, in px. */
  tremolo: number;
}

/** The rows a bar draws above and below its staff, in px; zero for an absent row. */
export interface TabRows {
  /** Upper voices' stems, beams and rests, above the top string. */
  upper: number;
  /** The word lanes' heights. */
  chord: number;
  fingering: number;
  text: number;
  /** Voice 1's stems, beams and tuplets, below the bottom string. */
  lower: number;
  /** How far voice 1's stems reach past the standard length, within `lower`. */
  lowerExtra: number;
  /** Arcs and their letters reaching past the top and bottom strings, in px. */
  arcsAbove: number;
  arcsBelow: number;
  lyrics: number;
}

export interface TabBar {
  /** Whether the tab carries the rhythm notation; false in both mode, where the standard staff does. */
  rhythm: boolean;
  voices: TabVoice[];
  beats: TabBeat[];
  rows: TabRows;
  /** Lyric lines the bar has a syllable on: 0 to `lyricLines`. */
  lyricLines: number;
  maxFingers: number;
}

export interface TabOptions {
  /** How a tied note shows on its string: in parentheses, or not at all (the tie still shows). */
  tiedNotes: TiedNotes;
}

/** Rhythm lives on the standard staff when a track shows both (the plan's reading of ADR-0007). */
export function rhythmOnTab(input: StaffBar): boolean {
  return !input.staves.includes('standard');
}

/** Guitar Pro's unused voices hold empty beats; a voice counts only when it has a note or a rest. */
export function voicePresent(voice: Voice): boolean {
  return voice.beats.some((beat) => beat.rest || beat.notes.length > 0);
}

const FINGERS: Readonly<Record<Finger, string>> = {
  thumb: 'T',
  index: '1',
  middle: '2',
  ring: '3',
  little: '4',
};
const PLUCKING: Readonly<Record<Finger, string>> = {
  thumb: 'p',
  index: 'i',
  middle: 'm',
  ring: 'a',
  little: 'c',
};

export function fingering(note: Note): string | undefined {
  const parts = [
    note.leftHandFinger && FINGERS[note.leftHandFinger],
    note.rightHandFinger && PLUCKING[note.rightHandFinger],
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function fretText(note: Note, options: TabOptions): string | undefined {
  const value = note.dead ? 'x' : (naturalHarmonicText(note) ?? String(note.fret));
  if (note.tie && options.tiedNotes === 'hidden') return undefined;
  return note.ghost || note.tie ? `(${value})` : value;
}

export function labelOf(note: Note, size: number, options: TabOptions): NoteLabel {
  const text = fretText(note, options);
  const label: NoteLabel = { note, text, width: textWidth(text ?? String(note.fret), size) };
  const suffix = text === undefined || note.dead ? undefined : suffixText(note);
  if (suffix) label.suffix = { text: suffix, width: textWidth(suffix, size * TAB.graceScale) };
  return label;
}

/** Room right of a label's knockout taken by its suffix with the suffix's own knockout, in px. */
export function suffixRoom(label: NoteLabel, size: number): number {
  if (!label.suffix) return 0;
  return TAB.suffixGap * size + label.suffix.width + 2 * TAB.knockoutX * size * TAB.graceScale;
}

/** Half a label's knockout box, horizontally. */
export function labelHalf(label: NoteLabel, size: number): number {
  return label.width / 2 + TAB.knockoutX * size;
}

/** Half a label's knockout box, vertically. */
export function labelHalfHeight(size: number): number {
  return textExtent(size).ascent / 2 + TAB.knockoutY * size;
}

const RESTS: Readonly<Record<number, GlyphName>> = {
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

export function restGlyph(duration: number): GlyphName {
  return RESTS[duration] ?? 'restQuarter';
}

function event(beat: Beat, tick: number): RhythmEvent {
  return {
    tick,
    ticks: beatTicks(beat),
    duration: beat.duration,
    dots: beat.dots,
    ...(beat.tuplet && { tuplet: beat.tuplet }),
    silent: beat.rest || beat.notes.length === 0,
  };
}

/** Voice 1 stems down; any other voice stems up when voice 1 is present too. */
export function voiceDirection(bar: Bar, voice: number): StemDirection {
  return voice === 0 || !voicePresent(bar.voices[0]) ? 'down' : 'up';
}

function analyseBeat(
  beat: Beat,
  voice: number,
  index: number,
  tick: number,
  direction: StemDirection,
  space: number,
  options: TabOptions,
  rhythmShown: boolean,
): TabBeat {
  const size = TAB.fretSize * space;
  const graceSize = size * TAB.graceScale;
  const labels = [...beat.notes]
    .sort((a, b) => a.string - b.string)
    .map((note) => labelOf(note, size, options));
  const graces = (beat.grace ?? []).map((grace): GraceColumn => {
    const graceLabels = grace.notes.map((note) => labelOf(note, graceSize, options));
    return {
      duration: grace.duration,
      labels: graceLabels,
      width: Math.max(0, ...graceLabels.map((label) => labelHalf(label, graceSize) * 2)),
      room: grace.notes.some((note) => note.bend) ? TAB.graceBendRoom * space : 0,
    };
  });
  const rhythm = event(beat, tick);
  let half: number;
  let right: number;
  if (beat.rest) {
    half = rhythmShown ? (glyphMetrics(restGlyph(beat.duration)).advance * space) / 2 : 0;
    const dots = rhythmShown && beat.dots > 0;
    right = half + (dots ? TAB.restSpacing * space + dotsWidth(beat.dots, space) : 0);
  } else {
    half = Math.max(0, ...labels.map((label) => labelHalf(label, size)));
    right = half;
    if (rhythmShown && labels.length > 0) {
      if (beat.dots > 0) right = Math.max(right, TAB.dotX * space + dotsWidth(beat.dots, space));
      right = Math.max(right, flagWidth(beat.duration, space));
    }
  }
  let slideIn = false;
  let slideOut = false;
  let bent = false;
  let drawn = false;
  for (const note of beat.rest ? [] : beat.notes) {
    for (const kind of note.slide ?? []) {
      if (kind === 'intoFromBelow' || kind === 'intoFromAbove') slideIn = true;
      if (kind === 'outDown' || kind === 'outUp') slideOut = true;
    }
    if (note.bend && note.bend.kind !== 'prebend') bent = true;
    if (note.bend || note.slide || note.hammerPull) drawn = true;
  }
  for (const grace of beat.grace ?? []) {
    for (const note of grace.notes) if (note.bend || note.slide) drawn = true;
  }
  if (slideOut) right = Math.max(right, half + TAB.slideRoom * space);
  if (bent) right = Math.max(right, half + TAB.bendRoom * space);
  for (const label of labels) {
    if (label.suffix) right = Math.max(right, labelHalf(label, size) + suffixRoom(label, size));
  }
  const played = !beat.rest && beat.notes.length > 0;
  const stroke =
    played && (beat.effects.arpeggio || beat.effects.brush) ? TAB.strokeRoom * space : 0;
  let left = half + stroke;
  if (slideIn) left += TAB.slideRoom * space;
  for (const column of graces) left += TAB.graceGap * space + column.width + column.room;
  return {
    voice,
    index,
    beat,
    tick,
    event: rhythm,
    direction,
    labels,
    graces,
    half,
    left,
    right,
    stroke,
    connects: drawn,
    dynamicsChange: false,
  };
}

function stemZone(extraStem: number, space: number): number {
  return (TAB.stemGap + TAB.stem + TAB.tupletRoom) * space + extraStem;
}

/** Where a beat's free stem starts and ends, from the stem base out, in staff spaces. */
export function freeStem(beat: Beat): { from: number; to: number } {
  const beams = beamCount(beat.duration);
  const length = TAB.stem + Math.max(0, beams - 2) * BEAM_PITCH;
  const from = (beat.duration === 2 ? TAB.halfStemSkip : 0) + TAB.tremoloGap;
  return { from, to: length - beams * BEAM_PITCH };
}

/** How much longer a beat's stem must be to hold its tremolo strokes, in staff spaces. */
function tremoloShortfall(beat: Beat): number {
  const name = tremoloGlyph(beat);
  if (!name) return 0;
  const { bbox } = glyphMetrics(name);
  const { from, to } = freeStem(beat);
  return Math.max(0, bbox.top - bbox.bottom + TAB.tremoloRoom - (to - from));
}

/** The side of its string a note's arcs bow to: up on the upper half of the strings, down below. */
export function arcSide(note: Note, strings: number): StemDirection {
  return note.string <= strings / 2 ? 'up' : 'down';
}

/**
 * How far arcs and their letters reach past the outer strings. A hammer-on's target and a legato
 * slide's origin, a grace note's legato slide included, keep room for the arc and the letter
 * beyond its apex; a grace hammer-on is covered by its main note. Below the bottom string, where
 * only the floor separates the tab from the next staff, every note also keeps room for a bare arc
 * on its string's side and on its voice's tie side: an origin half, a tie or a cut legato slide's
 * second half has its other end in a bar that measure does not read.
 */
function arcRoom(
  bar: Bar,
  strings: number,
  space: number,
): { arcsAbove: number; arcsBelow: number } {
  const bare = labelHalfHeight(TAB.fretSize * space) + TIE_MAX_HEIGHT * space;
  const letter = TAB.letterSize * space;
  const { ascent, descent } = textExtent(letter);
  const knockout = TAB.knockoutY * letter;
  // A letter's text box ends at the font's descent, past the knockout under it.
  const lettered = (side: StemDirection): number =>
    bare +
    TAB.letterGap * space +
    ascent +
    (side === 'up' ? knockout : Math.max(knockout, descent));
  const spacing = TAB.lineSpacing * space;
  const bottom = (strings - 1) * spacing;
  let arcsAbove = 0;
  let arcsBelow = 0;
  const keep = (string: number, side: StemDirection, reach: number): void => {
    const y = (string - 1) * spacing;
    if (side === 'up') arcsAbove = Math.max(arcsAbove, reach - y);
    else arcsBelow = Math.max(arcsBelow, y + reach - bottom);
  };
  for (const [index, voice] of bar.voices.entries()) {
    if (!voicePresent(voice)) continue;
    const tieSide = voiceDirection(bar, index);
    for (const beat of voice.beats) {
      if (beat.rest) continue;
      for (const note of beat.notes) {
        const side = arcSide(note, strings);
        if (note.hammerPull || note.slide?.includes('legato'))
          keep(note.string, side, lettered(side));
        if (side === 'down' || tieSide === 'down') keep(note.string, 'down', bare);
      }
      for (const grace of beat.grace ?? []) {
        for (const note of grace.notes) {
          const side = arcSide(note, strings);
          if (note.slide?.includes('legato')) keep(note.string, side, lettered(side));
        }
      }
    }
  }
  return { arcsAbove, arcsBelow };
}

const analyses = new WeakMap<Bar, Map<string, TabBar>>();

/**
 * Everything measure and render both need to know about a bar: its beats with their labels and
 * extents, beam and tuplet groups per voice, and which rows it draws. Depends on the bar alone,
 * so a cached measurement stays true.
 */
export function analyseBar(input: StaffBar, options: TabOptions): TabBar {
  const { bar, space } = input;
  const signature = input.masterBar.timeSignature;
  const rhythm = rhythmOnTab(input);
  const strings = input.track.tuning.length;
  const key = `${String(space)} ${options.tiedNotes} ${String(signature.numerator)}/${String(signature.denominator)} ${rhythm ? 'rhythm' : 'numbers'} ${String(strings)}`;
  const cached = analyses.get(bar)?.get(key);
  if (cached) return cached;

  const voices: TabVoice[] = [];
  const beats: TabBeat[] = [];
  const reserved: ReadonlySet<string> = rhythm ? reservedDynamics(bar) : new Set();
  let lyricLines = 0;
  let maxFingers = 0;
  let chord = false;
  let text = false;
  for (const [index, voice] of bar.voices.entries()) {
    if (!voicePresent(voice)) continue;
    const direction = voiceDirection(bar, index);
    const voiceBeats: TabBeat[] = [];
    let tick = 0;
    for (const [b, beat] of voice.beats.entries()) {
      const analysed = analyseBeat(beat, index, b, tick, direction, space, options, rhythm);
      analysed.dynamicsChange = reserved.has(beat.id);
      voiceBeats.push(analysed);
      tick += analysed.event.ticks;
      if (beat.chord) chord = true;
      if (beat.text !== undefined && beat.text !== '') text = true;
      for (const [line, syllable] of (beat.lyrics ?? []).entries()) {
        if (syllable !== '') lyricLines = Math.max(lyricLines, line + 1);
      }
      if (rhythm) {
        maxFingers = Math.max(
          maxFingers,
          beat.notes.filter((note) => fingering(note) !== undefined).length,
        );
      }
    }
    const events = voiceBeats.map((analysed) => analysed.event);
    const tuplets = tupletGroups(events);
    const beams = beamGroups(events, signature, tuplets);
    let extraBeams = 0;
    let tremolo = 0;
    for (const analysed of voiceBeats) {
      if (analysed.event.silent) continue;
      extraBeams = Math.max(extraBeams, beamCount(analysed.beat.duration) - 2);
      if (rhythm) tremolo = Math.max(tremolo, tremoloShortfall(analysed.beat));
    }
    voices.push({
      index,
      direction,
      beats: voiceBeats,
      beams,
      tuplets,
      extraStem: (extraBeams * BEAM_PITCH + tremolo) * space,
      tremolo: tremolo * space,
    });
    beats.push(...voiceBeats);
  }

  const lowerExtra = Math.max(
    0,
    ...voices.filter((v) => v.direction === 'down').map((v) => v.extraStem),
  );
  const uppers = rhythm ? voices.filter((v) => v.direction === 'up') : [];
  const rows: TabRows = {
    upper: uppers.length > 0 ? stemZone(Math.max(...uppers.map((v) => v.extraStem)), space) : 0,
    fingering: maxFingers * TAB.fingerRow * space,
    chord: chord ? TAB.chordRow * space : 0,
    text: text ? TAB.textRow * space : 0,
    lower: rhythm ? stemZone(lowerExtra, space) : 0,
    lowerExtra,
    lyrics: lyricLines * TAB.lyricRow * space,
    ...arcRoom(bar, strings, space),
  };
  const analysed: TabBar = { rhythm, voices, beats, rows, lyricLines, maxFingers };
  let byKey = analyses.get(bar);
  if (!byKey) {
    byKey = new Map();
    analyses.set(bar, byKey);
  }
  byKey.set(key, analysed);
  return analysed;
}

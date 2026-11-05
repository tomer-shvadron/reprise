import {
  beatTicks,
  type Bar,
  type Beat,
  type Dynamics,
  type Finger,
  type Note,
} from '@reprise/model';

import { glyphMetrics, textExtent, textWidth, type GlyphName } from '../../metrics';
import {
  BEAM_PITCH,
  beamCount,
  beamGroups,
  dotsWidth,
  flagWidth,
  tupletGroups,
  type RhythmEvent,
  type StemDirection,
  type TupletGroup,
} from '../rhythm';
import type { StaffBar } from '../staff-module';

/** Every size and distance of the tab staff, in staff spaces. */
export const TAB = {
  lineSpacing: 1.5,
  fretSize: 1.3,
  /** Paper kept around a fret number so the string line stops short of it, in ems of the number. */
  knockoutX: 0.12,
  knockoutY: 0.09,
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
  /** Where words above the staff start when no upper voice is drawn: clear of the fret numbers. */
  wordClearance: 0.75,
  restSpacing: 0.3,
} as const;

export interface NoteLabel {
  note: Note;
  /** The text on the string; `undefined` for a tied note when tied notes are hidden. */
  text: string | undefined;
  /** Width of the text, or of the fret number it stands for when hidden, in px. */
  width: number;
}

export interface GraceColumn {
  duration: 16 | 32 | 64;
  labels: NoteLabel[];
  /** Widest label, in px. */
  width: number;
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
  /**
   * Whether the beat's dynamic differs from the one before it in the bar, or from Guitar Pro's
   * default at the bar's first; render compares across the bar line instead, and the row has
   * room for either.
   */
  dynamicsChange: boolean;
}

export interface TabVoice {
  index: number;
  direction: StemDirection;
  beats: TabBeat[];
  beams: number[][];
  tuplets: TupletGroup[];
  /** How far stems reach past the standard length for the beams they carry, in px. */
  extraStem: number;
}

/** The rows a bar draws above and below its staff, in px; zero for an absent row. */
export interface TabRows {
  /** Upper voices' stems, beams and rests, above the top string. */
  upper: number;
  /** Between the top string and the words when there is no upper voice. */
  clearance: number;
  /** Word rows above the staff, upwards in this order: the most common nearest, so it aligns. */
  chord: number;
  fingering: number;
  text: number;
  /** Voice 1's stems, beams, tuplets and the bar's dynamics, below the bottom string. */
  lower: number;
  /** How far voice 1's stems reach past the standard length, within `lower`. */
  lowerExtra: number;
  lyrics: number;
}

export interface TabBar {
  voices: TabVoice[];
  beats: TabBeat[];
  rows: TabRows;
  /** Lyric lines the bar has a syllable on: 0 to `lyricLines`. */
  lyricLines: number;
  maxFingers: number;
}

export interface TabOptions {
  /** How a tied note shows on its string: in parentheses, or not at all (the tie still shows). */
  tiedNotes: 'parenthesised' | 'hidden';
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
  const value = note.dead ? 'x' : String(note.fret);
  if (note.tie && options.tiedNotes === 'hidden') return undefined;
  return note.ghost || note.tie ? `(${value})` : value;
}

export function labelOf(note: Note, size: number, options: TabOptions): NoteLabel {
  const text = fretText(note, options);
  return { note, text, width: textWidth(text ?? String(note.fret), size) };
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

/** The dynamic a beat plays at: its first note's, or none for a rest or empty beat. */
export function beatDynamics(beat: Beat): Dynamics | undefined {
  return beat.notes[0]?.dynamics;
}

export const DYNAMICS_GLYPHS: Readonly<Record<Dynamics, GlyphName>> = {
  ppp: 'dynamicPPP',
  pp: 'dynamicPP',
  p: 'dynamicPiano',
  mp: 'dynamicMP',
  mf: 'dynamicMF',
  f: 'dynamicForte',
  ff: 'dynamicFF',
  fff: 'dynamicFFF',
};

/** Guitar Pro's default: a dynamic is only written where it changes from this. */
export const DEFAULT_DYNAMICS: Dynamics = 'f';

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

/** Voice 1 stems down; any other voice stems up when voice 1 has beats too. */
export function voiceDirection(bar: Bar, voice: number): StemDirection {
  return voice === 0 || bar.voices[0].beats.length === 0 ? 'down' : 'up';
}

function analyseBeat(
  beat: Beat,
  voice: number,
  index: number,
  tick: number,
  direction: StemDirection,
  space: number,
  options: TabOptions,
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
    };
  });
  const rhythm = event(beat, tick);
  let half: number;
  let right: number;
  if (beat.rest) {
    half = (glyphMetrics(restGlyph(beat.duration)).advance * space) / 2;
    right = half + (beat.dots > 0 ? TAB.restSpacing * space + dotsWidth(beat.dots, space) : 0);
  } else {
    half = Math.max(0, ...labels.map((label) => labelHalf(label, size)));
    right = half;
    if (!rhythm.silent || labels.length > 0) {
      if (beat.dots > 0) right = Math.max(right, TAB.dotX * space + dotsWidth(beat.dots, space));
      right = Math.max(right, flagWidth(beat.duration, space));
    }
  }
  let left = half;
  for (const column of graces) left += TAB.graceGap * space + column.width;
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
    dynamicsChange: false,
  };
}

function markDynamicsChanges(beats: readonly TabBeat[]): void {
  let current = DEFAULT_DYNAMICS;
  for (const analysed of beats) {
    const dynamics = beatDynamics(analysed.beat);
    if (dynamics === undefined) continue;
    analysed.dynamicsChange = dynamics !== current;
    current = dynamics;
  }
}

function stemZone(extraStem: number, space: number): number {
  return (TAB.stemGap + TAB.stem + TAB.tupletRoom) * space + extraStem;
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
  const key = `${String(space)} ${options.tiedNotes} ${String(signature.numerator)}/${String(signature.denominator)}`;
  const cached = analyses.get(bar)?.get(key);
  if (cached) return cached;

  const voices: TabVoice[] = [];
  const beats: TabBeat[] = [];
  let lyricLines = 0;
  let maxFingers = 0;
  let chord = false;
  let text = false;
  for (const [index, voice] of bar.voices.entries()) {
    if (voice.beats.length === 0) continue;
    const direction = voiceDirection(bar, index);
    const voiceBeats: TabBeat[] = [];
    let tick = 0;
    for (const [b, beat] of voice.beats.entries()) {
      const analysed = analyseBeat(beat, index, b, tick, direction, space, options);
      voiceBeats.push(analysed);
      tick += analysed.event.ticks;
      if (beat.chord) chord = true;
      if (beat.text !== undefined && beat.text !== '') text = true;
      for (const [line, syllable] of (beat.lyrics ?? []).entries()) {
        if (syllable !== '') lyricLines = Math.max(lyricLines, line + 1);
      }
      maxFingers = Math.max(
        maxFingers,
        beat.notes.filter((note) => fingering(note) !== undefined).length,
      );
    }
    markDynamicsChanges(voiceBeats);
    const events = voiceBeats.map((analysed) => analysed.event);
    const tuplets = tupletGroups(events);
    const beams = beamGroups(events, signature, tuplets);
    let extraBeams = 0;
    for (const analysed of voiceBeats) {
      if (!analysed.event.silent)
        extraBeams = Math.max(extraBeams, beamCount(analysed.beat.duration) - 2);
    }
    voices.push({
      index,
      direction,
      beats: voiceBeats,
      beams,
      tuplets,
      extraStem: extraBeams * BEAM_PITCH * space,
    });
    beats.push(...voiceBeats);
  }

  const lowerExtra = Math.max(
    0,
    ...voices.filter((v) => v.direction === 'down').map((v) => v.extraStem),
  );
  const uppers = voices.filter((v) => v.direction === 'up');
  const rows: TabRows = {
    upper: uppers.length > 0 ? stemZone(Math.max(...uppers.map((v) => v.extraStem)), space) : 0,
    clearance: uppers.length > 0 ? 0 : TAB.wordClearance * space,
    fingering: maxFingers * TAB.fingerRow * space,
    chord: chord ? TAB.chordRow * space : 0,
    text: text ? TAB.textRow * space : 0,
    lower: stemZone(lowerExtra, space),
    lowerExtra,
    lyrics: lyricLines * TAB.lyricRow * space,
  };
  const analysed: TabBar = { voices, beats, rows, lyricLines, maxFingers };
  let byKey = analyses.get(bar);
  if (!byKey) {
    byKey = new Map();
    analyses.set(bar, byKey);
  }
  byKey.set(key, analysed);
  return analysed;
}

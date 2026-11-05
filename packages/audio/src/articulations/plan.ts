import { beatTicks, midiNote } from '@reprise/model';
import type { BeatEffects, BendPoint, Note, Track, Vibrato } from '@reprise/model';

import type { FilterSettings } from '../sampler/voice';
import { soundingKey } from './harmonics';
import { ARTICULATION } from './parameters';
import { noteVelocity } from './velocity';

export type PlanTrack = Pick<Track, 'kind' | 'tuning' | 'capo'>;

/** One note to voice: a scheduler event, or a grace note placed by the sink. */
export interface PlanInput {
  track: PlanTrack;
  note: Note;
  /** The beat's effects; a grace note has none of its own. */
  effects: BeatEffects;
  when: number;
  /** Seconds to the release, ties folded in. */
  length: number;
  /** Seconds of the note's own beat, which bends, whammy and fades span. */
  beatLength: number;
  secondsPerTick: number;
  barEnd: number;
  next: { note: Note; when: number } | undefined;
  /** The key of the voice a legato slide carries into this note, which then has no attack. */
  continues?: number;
}

/** One attack: a voice started at `when` and released at `end`. */
export interface Strike {
  key: number;
  /** Semitones added to the note's pitch curve: a harmonic's fraction or a legato's distance. */
  detune: number;
  velocity: number;
  when: number;
  end: number;
  offset?: number;
}

/** A level breakpoint; levels between breakpoints are linear in dB. */
export interface GainPoint {
  at: number;
  db: number;
}

export interface NotePlan {
  strikes: Strike[];
  /** The first strike is the voice a legato slide carried in, not a new one. */
  continues: boolean;
  /** A dead note: a short filtered noise burst instead of the instrument. */
  dead: boolean;
  /** Semitones relative to each strike's pitch at an absolute time; absent when flat. */
  pitch: ((time: number) => number) | undefined;
  gain: GainPoint[];
  filter: FilterSettings | undefined;
  letRingUntil: number | undefined;
  /** The last strike's voice is not released: it carries into the next note, starting here. */
  legatoInto: number | undefined;
}

type PitchTerm = (time: number) => number;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Bend and whammy points: position 0 to 60 across `span`, values in quarter tones. */
function pointsCurve(points: readonly BendPoint[], start: number, span: number): PitchTerm {
  const sorted = [...points].sort((a, b) => a.position - b.position);
  return (time) => {
    const position = span > 0 ? ((time - start) / span) * 60 : 60;
    let previous = sorted[0];
    if (!previous) return 0;
    if (position <= previous.position) return previous.value / 2;
    for (const point of sorted) {
      if (position <= point.position) {
        const width = point.position - previous.position;
        const share = width > 0 ? (position - previous.position) / width : 1;
        return (previous.value + (point.value - previous.value) * share) / 2;
      }
      previous = point;
    }
    return previous.value / 2;
  };
}

function wider(a: Vibrato, b: Vibrato | undefined): Vibrato {
  if (a === 'wide' || b === 'wide') return 'wide';
  return a === 'slight' || b === 'slight' ? 'slight' : 'none';
}

function slideTerms(input: PlanInput, key: number, end: number): PitchTerm[] {
  const { note, when, next, track } = input;
  const slides = note.slide ?? [];
  const terms: PitchTerm[] = [];
  const shortWindow = Math.min(ARTICULATION.slideInOutTime, (end - when) / 3);
  const interval = ARTICULATION.slideInterval;
  for (const kind of slides) {
    if (kind === 'intoFromBelow' || kind === 'intoFromAbove') {
      const from = kind === 'intoFromBelow' ? -interval : interval;
      terms.push((time) => from * (1 - clamp01((time - when) / shortWindow)));
    } else if (kind === 'outDown' || kind === 'outUp') {
      const to = kind === 'outDown' ? -interval : interval;
      const start = end - shortWindow;
      terms.push((time) => to * clamp01((time - start) / shortWindow));
    }
  }
  const glides = slides.includes('legato') || slides.includes('shift');
  if (glides && next) {
    const target = soundingKey(track, next.note) - key;
    const arrive = Math.min(end, next.when);
    const glide = Math.min(
      ARTICULATION.slideFraction * (arrive - when),
      ARTICULATION.slideMaxGlide,
    );
    const start = arrive - glide;
    terms.push((time) => (glide > 0 ? target * clamp01((time - start) / glide) : 0));
  }
  return terms;
}

function pitchTerms(input: PlanInput, key: number, end: number): PitchTerm[] {
  const { note, effects, when, beatLength } = input;
  const terms: PitchTerm[] = [];
  if (note.bend) terms.push(pointsCurve(note.bend.points, when, beatLength));
  if (effects.whammy) terms.push(pointsCurve(effects.whammy.points, when, beatLength));
  const vibrato = wider(note.vibrato, effects.vibrato);
  if (vibrato !== 'none') {
    const { rate, depth } = ARTICULATION.vibrato[vibrato];
    terms.push((time) => depth * Math.sin(2 * Math.PI * rate * (time - when)));
  }
  terms.push(...slideTerms(input, key, end));
  return terms;
}

function gainPoints(input: PlanInput, tonal: boolean): GainPoint[] {
  const { effects, note, when, beatLength } = input;
  const floor = ARTICULATION.fadeFloor;
  const end = when + beatLength;
  if (effects.volumeSwell) {
    return [
      { at: when, db: floor },
      { at: when + beatLength / 2, db: 0 },
      { at: end, db: floor },
    ];
  }
  if (effects.fadeIn) {
    return [
      { at: when, db: floor },
      { at: end, db: 0 },
    ];
  }
  if (effects.fadeOut) {
    return [
      { at: when, db: 0 },
      { at: end, db: floor },
    ];
  }
  if (tonal && note.palmMute) {
    const { decayTo, decayTime } = ARTICULATION.palmMute;
    return [
      { at: when, db: 0 },
      { at: when + decayTime, db: decayTo },
    ];
  }
  return [];
}

function filterFor(note: Note): FilterSettings | undefined {
  if (note.dead) return { type: 'lowpass', frequency: ARTICULATION.dead.cutoff };
  if (note.palmMute) return { type: 'lowpass', frequency: ARTICULATION.palmMute.cutoff };
  if (note.harmonic) {
    const { shelfFrequency, shelfGain } = ARTICULATION.harmonic;
    return { type: 'highshelf', frequency: shelfFrequency, gain: shelfGain };
  }
  return undefined;
}

/** Retriggers every `step` seconds across the note, the last one held to its end. */
function retriggers(when: number, end: number, step: number): { when: number; end: number }[] {
  const count = Math.max(1, Math.floor((end - when) / step + 1e-6));
  return Array.from({ length: count }, (_, index) => ({
    when: when + index * step,
    end: index === count - 1 ? end : when + (index + 1) * step,
  }));
}

/**
 * How one note sounds: its attacks, pitch curve, level shape, filter and release. Pure, so the
 * mapping is testable without rendering. Drum tracks take only velocity, fades and retriggers;
 * pitch, filter and length articulations are a string instrument's.
 */
export function planNote(input: PlanInput): NotePlan {
  const { track, note, effects, when } = input;
  const tonal = track.kind !== 'drums';
  const key = soundingKey(track, note);
  const rounded = Math.round(key);
  const dead = tonal && note.dead;
  const continues = input.continues;

  let end = when + input.length;
  if (tonal && note.staccato) end = when + input.length * ARTICULATION.staccatoFraction;
  if (dead) end = Math.min(end, when + ARTICULATION.dead.length);

  const legato = tonal && !dead && input.next !== undefined && note.slide?.includes('legato');
  const legatoInto = legato ? input.next?.when : undefined;

  const velocity = noteVelocity(note);
  const softened = noteVelocity(note, { hammer: true });
  const base: Strike = {
    key: continues ?? rounded,
    detune: key - (continues ?? rounded),
    velocity: note.hammerPull ? softened : velocity,
    when,
    end,
    ...(note.hammerPull && { offset: ARTICULATION.hammerOffset }),
  };

  let strikes: Strike[] = [base];
  if (note.trill && !dead) {
    const step = beatTicks({ duration: note.trill.speed, dots: 0 }) * input.secondsPerTick;
    const other = midiNote(track, { string: note.string, fret: note.trill.fret });
    strikes = retriggers(when, end, step).map((span, index) => {
      if (index === 0) return { ...base, end: span.end };
      return {
        key: index % 2 === 1 ? other : rounded,
        detune: index % 2 === 1 ? 0 : key - rounded,
        velocity: softened,
        offset: ARTICULATION.hammerOffset,
        ...span,
      };
    });
  } else if (effects.tremoloPicking && !dead) {
    const step = beatTicks({ duration: effects.tremoloPicking, dots: 0 }) * input.secondsPerTick;
    strikes = retriggers(when, end, step).map((span, index) => {
      if (index === 0) return { ...base, end: span.end };
      return { key: rounded, detune: key - rounded, velocity, ...span };
    });
  }

  const terms = tonal && !dead ? pitchTerms(input, key, end) : [];
  const pitch =
    terms.length > 0
      ? (time: number): number => terms.reduce((sum, term) => sum + term(time), 0)
      : undefined;

  return {
    strikes,
    continues: continues !== undefined,
    dead,
    pitch,
    gain: gainPoints(input, tonal),
    filter: tonal ? filterFor(note) : undefined,
    letRingUntil:
      tonal && note.letRing && legatoInto === undefined ? Math.max(input.barEnd, end) : undefined,
    legatoInto,
  };
}

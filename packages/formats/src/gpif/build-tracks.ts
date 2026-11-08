import {
  MAX_STRINGS,
  createTrack,
  newId,
  type Clef,
  type Dynamics,
  type Note,
  type Notation,
  type Track,
  type TrackKind,
} from '@reprise/model';

import type { GpifNote, GpifStaff, GpifTrack, NoteFields } from './document';
import type { TrackNotation } from './part-configuration';
import type { WarningSink } from './warnings';

/** GM2 percussion keys, high Q to open surdo. */
const GM_PERCUSSION_MIN = 27;
const GM_PERCUSSION_MAX = 87;

/** General MIDI programs of fretted instruments: guitars and basses, then sitar, banjo, shamisen, koto. */
function isFrettedProgram(program: number): boolean {
  return (program >= 24 && program <= 39) || (program >= 104 && program <= 107);
}

/**
 * How one gpif track becomes a model track, and how its notes resolve. Guitar Pro 7 gives every
 * track a six-string tuning, a piano included, so the tuning cannot tell a keyboard from a
 * guitar. The rule is the one the fixture manifest's oracle uses: a drum kit is `drums`; a track
 * whose program is outside the fretted families and which shows no tablature is `pitched`;
 * everything else is `fretted`. Without the container's part configuration (a bare gpif), the
 * program decides alone.
 */
export interface TrackPlan {
  source: GpifTrack;
  kind: TrackKind;
  staff: GpifStaff;
  tuning: number[];
  capo: number;
  /** Tuning and capo of each staff; a staff without a tuning of its own shares the first's. */
  staves: { tuning: number[]; capo: number }[];
  /** Index of the first later staff whose own tuning or capo differs from the first's. */
  differingStaff?: number;
}

function sameTuning(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export function planTrack(
  sink: WarningSink,
  source: GpifTrack,
  notation?: TrackNotation,
): TrackPlan {
  const staff: GpifStaff = source.staves[0] ?? { capo: 0, chords: new Map() };
  let tuning = staff.tuning ?? [];
  if (tuning.length > MAX_STRINGS) {
    sink.warn(
      'invalid-value',
      source.path,
      `A tuning of ${String(tuning.length)} strings exceeds ${String(MAX_STRINGS)}; the extra strings are dropped`,
    );
    tuning = tuning.slice(0, MAX_STRINGS);
  }
  const staves = (source.staves.length > 0 ? source.staves : [staff]).map((own) => ({
    tuning: own.tuning?.slice(0, MAX_STRINGS) ?? tuning,
    capo: own.tuning === undefined ? staff.capo : own.capo,
  }));
  const differing = staves.findIndex(
    (own, i) => i > 0 && !(sameTuning(own.tuning, tuning) && own.capo === staff.capo),
  );
  let kind: TrackKind = 'fretted';
  if (source.drums) kind = 'drums';
  else if (tuning.length === 0) kind = 'pitched';
  else if (differing > 0) kind = 'pitched';
  else if (!isFrettedProgram(source.program) && notation?.tab !== true) kind = 'pitched';
  return {
    source,
    kind,
    staff,
    tuning,
    capo: staff.capo,
    staves,
    ...(kind === 'pitched' && tuning.length > 0 && differing > 0 && { differingStaff: differing }),
  };
}

function notationOf(kind: TrackKind, notation: TrackNotation | undefined): Notation | undefined {
  if (!notation) return undefined;
  if (kind !== 'fretted') return 'standard';
  if (notation.standard && notation.tab) return 'both';
  return notation.tab ? 'tab' : 'standard';
}

export function createModelTrack(
  plan: TrackPlan,
  notation: TrackNotation | undefined,
  clef: Clef | undefined,
): Track {
  const { source, kind } = plan;
  const track = createTrack(kind, { bars: [] });
  track.name = source.name;
  track.shortName = source.shortName;
  if (source.color !== undefined) track.color = source.color;
  track.program = source.program;
  track.bank = source.bank;
  track.channel = {
    ...track.channel,
    mute: source.mute,
    solo: source.solo,
    ...(source.volume !== undefined && { volume: source.volume }),
    ...(source.pan !== undefined && { pan: source.pan }),
  };
  if (kind !== 'drums') {
    // A pitched track keeps the file's tuning and neck so a gp writer can finger it again.
    track.tuning = [...plan.tuning];
    track.fretCount = plan.staff.fretCount ?? 24;
    track.capo = kind === 'fretted' ? plan.capo : 0;
  }
  const display = notationOf(kind, notation);
  if (display) track.display.notation = display;
  if (clef) track.display.clef = clef;
  if (source.octaveShift !== undefined) track.display.octaveShift = source.octaveShift;
  track.lyrics = source.lyrics;
  return track;
}

/** Hammer-on flags travel beside the model note until the reader moves them to destinations. */
export interface NoteLinks {
  hopoOrigin: boolean;
}

/**
 * A fresh model note for one reference to a gpif note. Fretted strings flip from gpif's
 * lowest-first index to the model's highest-first number; drum notes take the articulation's
 * output MIDI note; pitched notes take the MIDI number, or GP6's octave and tone.
 */
export function resolveNote(
  sink: WarningSink,
  plan: TrackPlan,
  note: GpifNote,
  dynamics: Dynamics,
  staffIndex = 0,
): Note | undefined {
  let string = 0;
  let fret: number | undefined;
  /** The pitch of fret 0 on this note's string; absent off fretted tracks. */
  let stringPitch: number | undefined;
  if (plan.kind === 'fretted') {
    if (note.string === undefined) {
      sink.warn('invalid-value', note.path, 'A note without a string on a fretted track; dropped');
      return undefined;
    }
    string = plan.tuning.length - note.string;
    fret = note.fret;
    const open = plan.tuning[note.string];
    if (open !== undefined) stringPitch = open + plan.capo;
    if (fret === undefined && note.midi !== undefined && stringPitch !== undefined) {
      fret = note.midi - stringPitch;
    }
  } else if (plan.kind === 'drums') {
    const articulation =
      note.articulation === undefined ? undefined : plan.source.articulations[note.articulation];
    if (articulation) {
      fret = articulation.output;
      if (note.midi !== undefined && note.midi !== articulation.output) {
        sink.warn(
          'drum-articulation',
          note.path,
          `Drum articulation variants play as their base sound ("${articulation.name}" as MIDI ${String(articulation.output)}); the variant is not modelled`,
          plan.source.id,
        );
      }
    } else {
      fret = note.midi;
      // GP6 numbers drum notes like GP7's articulation inputs, so a variant runs past GM.
      if (fret !== undefined && (fret < GM_PERCUSSION_MIN || fret > GM_PERCUSSION_MAX)) {
        sink.warn(
          'invalid-value',
          note.path,
          `Drum note ${String(fret)} has no articulation and is outside GM percussion (${String(GM_PERCUSSION_MIN)} to ${String(GM_PERCUSSION_MAX)}); kept as is`,
          `${plan.source.id}:gm-percussion`,
        );
      }
    }
  } else {
    fret = note.midi;
    if (fret === undefined && note.octave !== undefined) fret = note.octave * 12 + (note.tone ?? 0);
    if (fret === undefined && note.string !== undefined && note.fret !== undefined) {
      const own = plan.staves[staffIndex] ?? plan.staves[0];
      const open = own?.tuning[note.string];
      if (own && open !== undefined) fret = open + own.capo + note.fret;
    }
  }
  if (fret === undefined || !Number.isInteger(fret) || fret < 0 || fret > 127) {
    sink.warn(
      'invalid-value',
      note.path,
      'A note whose fret or pitch is outside 0 to 127; dropped',
    );
    return undefined;
  }
  const result: Note = { id: newId(), string, fret, dynamics, ...cloneNoteFields(note.fields) };
  if (note.accidental !== undefined) result.accidental = note.accidental;
  if (note.trill !== undefined) {
    // gpif keeps no trill speed; Guitar Pro plays sixteenths, as alphaTab's reader assumes.
    const trillFret =
      plan.kind === 'fretted' ? note.trill - (stringPitch ?? Number.NaN) : note.trill;
    if (trillFret >= 0 && trillFret <= 127) result.trill = { fret: trillFret, speed: 16 };
    else {
      sink.warn(
        'invalid-value',
        note.path,
        `A trill to MIDI ${String(note.trill)} has no fret on this string; dropped`,
      );
    }
  }
  return result;
}

/** A deep copy, so notes read from one shared gpif note never share nested objects. */
export function cloneNoteFields(fields: NoteFields): NoteFields {
  const copy: NoteFields = { ...fields };
  if (fields.bend)
    copy.bend = { kind: fields.bend.kind, points: fields.bend.points.map((p) => ({ ...p })) };
  if (fields.slide) copy.slide = [...fields.slide];
  if (fields.harmonic) copy.harmonic = { ...fields.harmonic };
  return copy;
}

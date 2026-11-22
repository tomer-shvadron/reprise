import {
  MAX_STRINGS,
  STANDARD_TUNINGS,
  createTrack,
  findTuningName,
  isVocalTrack,
  type Drone,
  type Score,
  type Track,
  type TrackChanges,
  type TrackKind,
  type TrackProperties,
  type TuningInstrument,
} from '@reprise/model';

import type { NotationDefaults } from '@/state/notation-defaults';

export const MIN_STRINGS = 4;
export const MIN_TUNING_NOTE = 12;
export const MAX_TUNING_NOTE = 96;

const NEW_STRING_INTERVAL = 5;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** What a new fretted track of each instrument starts with before the user types. */
const INSTRUMENT_DEFAULTS: Record<
  TuningInstrument,
  { name: string; shortName: string; program: number }
> = {
  guitar: { name: 'Guitar', shortName: 'Gtr.', program: 25 },
  bass: { name: 'Bass', shortName: 'Bs.', program: 33 },
  ukulele: { name: 'Ukulele', shortName: 'Uke.', program: 24 },
  twelveString: { name: '12-string Guitar', shortName: '12-str.', program: 25 },
  banjo: { name: 'Banjo', shortName: 'Bjo.', program: 105 },
  mandolin: { name: 'Mandolin', shortName: 'Mand.', program: 25 },
};

/**
 * The track dialog's state. The text fields stay strings so a half-typed value validates instead
 * of snapping; `strings` runs string 1 (the highest) first as Guitar Pro lists them, the reverse
 * of `Track.tuning`, and is flipped only in `formFromTrack` and `trackChanges`.
 */
export interface TrackForm {
  kind: TrackKind;
  name: string;
  shortName: string;
  color: string;
  strings: number[];
  /**
   * The second string of each course, in `strings` order (string 1 first); `undefined` for a track
   * of single strings. Not editable per string in v1: a preset sets it and the string count keeps
   * it the length of `strings`.
   */
  courses: (number | null)[] | undefined;
  /** The banjo's short string, carried from its preset or track; the dialog has no control for it yet. */
  drone: Drone | undefined;
  capo: string;
  program: number;
  /** A name the user typed: a preset's default name never replaces it. */
  nameEdited: boolean;
  /** While false the short name follows the name. */
  shortNameEdited: boolean;
  programEdited: boolean;
  /**
   * The add dialog's "Percussion" choice: a drums track named for what it is. Guitar Pro has no
   * separate percussion type, so the model sees an ordinary drum track.
   */
  percussion: boolean;
}

export interface TrackFormErrors {
  name?: string;
  shortName?: string;
  color?: string;
  capo?: string;
  /** The notes on strings the new count would drop, or a count the model cannot hold. */
  strings?: string;
}

/** The first four letters and a full stop, as the short name follows the name. */
export function shortNameOf(name: string): string {
  const trimmed = name.trim();
  return trimmed === '' ? '' : `${trimmed.slice(0, 4)}.`;
}

export function formFromTrack(track: Track): TrackForm {
  return {
    kind: track.kind,
    name: track.name,
    shortName: track.shortName,
    color: track.color,
    strings: [...track.tuning].reverse(),
    courses: track.courses ? [...track.courses].reverse() : undefined,
    drone: track.drone,
    capo: String(track.capo),
    program: track.program,
    nameEdited: true,
    shortNameEdited: track.shortName !== shortNameOf(track.name),
    programEdited: true,
    percussion: false,
  };
}

/** The add-mode defaults of a kind: the model's own track defaults, nothing typed yet. */
export function newTrackForm(kind: TrackKind): TrackForm {
  const base = createTrack(kind, { barCount: 0 });
  return {
    ...formFromTrack(base),
    nameEdited: false,
    shortNameEdited: false,
    programEdited: false,
    percussion: false,
  };
}

/** The "Percussion" choice: the drums defaults under its own name, which a typed name still beats. */
export function percussionForm(form: TrackForm): TrackForm {
  if (form.percussion) return form;
  const next = form.kind === 'drums' ? form : changeKind(form, 'drums');
  return {
    ...next,
    name: next.nameEdited ? next.name : 'Percussion',
    shortName: next.nameEdited || next.shortNameEdited ? next.shortName : 'Perc.',
    percussion: true,
  };
}

/** Picking another kind starts again from its defaults, keeping a colour and a name the user typed. */
export function changeKind(form: TrackForm, kind: TrackKind): TrackForm {
  if (kind === form.kind) {
    if (!form.percussion) return form;
    // Drums and Percussion share their kits, so only the default names swap back.
    const drums = newTrackForm('drums');
    return {
      ...form,
      percussion: false,
      name: form.nameEdited ? form.name : drums.name,
      shortName: form.nameEdited || form.shortNameEdited ? form.shortName : drums.shortName,
    };
  }
  const next = newTrackForm(kind);
  const base = newTrackForm(form.kind);
  let kept: TrackForm = { ...next, color: form.color === base.color ? next.color : form.color };
  if (form.nameEdited) {
    kept = {
      ...kept,
      name: form.name,
      nameEdited: true,
      shortName: shortNameOf(form.name),
    };
  }
  if (form.shortNameEdited) kept = { ...kept, shortName: form.shortName, shortNameEdited: true };
  return kept;
}

export function setName(form: TrackForm, name: string): TrackForm {
  return {
    ...form,
    name,
    nameEdited: true,
    shortName: form.shortNameEdited ? form.shortName : shortNameOf(name),
  };
}

export function setShortName(form: TrackForm, shortName: string): TrackForm {
  return { ...form, shortName, shortNameEdited: true };
}

export function setProgram(form: TrackForm, program: number): TrackForm {
  return { ...form, program, programEdited: true };
}

const modelOrder = <T>(list: readonly T[]): T[] => [...list].reverse();

/** The tuning table's name for the form's strings, or undefined for a custom tuning. */
export function presetNameOf(form: TrackForm): string | undefined {
  // The courses are part of the name: a 12-string's E standard is "12-string standard".
  return findTuningName(modelOrder(form.strings), {
    courses: form.courses && modelOrder(form.courses),
    drone: form.drone,
  });
}

/**
 * Chooses a table tuning, or leaves the strings as they are for `undefined` (Custom). When adding
 * a track, its instrument also renames, re-shortens and re-programs whatever the user has not
 * touched.
 */
export function applyPreset(form: TrackForm, name: string | undefined, adding: boolean): TrackForm {
  const preset = STANDARD_TUNINGS.find((tuning) => tuning.name === name);
  if (!preset) return form;
  let next: TrackForm = {
    ...form,
    strings: modelOrder(preset.strings),
    courses: preset.courses ? modelOrder(preset.courses) : undefined,
    drone: preset.drone,
  };
  if (adding && form.kind === 'fretted') {
    const defaults = INSTRUMENT_DEFAULTS[preset.instrument];
    if (!form.nameEdited) next = { ...next, name: defaults.name };
    if (!form.shortNameEdited) {
      next = { ...next, shortName: form.nameEdited ? shortNameOf(next.name) : defaults.shortName };
    }
    if (!form.programEdited) next = { ...next, program: defaults.program };
  }
  return next;
}

/**
 * A new string count: strings are added a fourth below the lowest, or the lowest ones dropped,
 * which leaves string 1 and every kept string exactly as they were. E standard gains the 7-string
 * B and bass standard the 5-string low B this way, so the table names still show up.
 */
export function setStringCount(form: TrackForm, count: number): TrackForm {
  const current = form.strings.length;
  if (count === current || count < 1 || count > MAX_STRINGS) return form;
  // The short string belongs to the 5-string banjo: any other count clears it, as the dialog shows
  // its checkbox on five strings only.
  const drone = count === 5 ? form.drone : undefined;
  if (count < current) {
    return {
      ...form,
      strings: form.strings.slice(0, count),
      courses: form.courses?.slice(0, count),
      drone,
    };
  }
  const strings = [...form.strings];
  const courses = form.courses && [...form.courses];
  while (strings.length < count) {
    const lowest = strings.at(-1) ?? 40;
    strings.push(Math.max(0, lowest - NEW_STRING_INTERVAL));
    // The new string joins the lowest course's layout: an octave course on a 12-string, a unison one on a mandolin.
    courses?.push(courses.at(-1) ?? null);
  }
  return { ...form, strings, courses, drone };
}

export function setString(form: TrackForm, string: number, note: number): TrackForm {
  return { ...form, strings: form.strings.map((pitch, i) => (i === string - 1 ? note : pitch)) };
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** "E2", "A♯1": the note an open string sounds, middle C being C4 (MIDI 60). */
export function noteLabel(midi: number): string {
  return `${NOTE_NAMES[midi % 12] ?? ''}${String(Math.floor(midi / 12) - 1)}`;
}

/** The pitches a string select offers, with the current one kept even when it lies outside. */
export function tuningNoteOptions(current: number): number[] {
  const options: number[] = [];
  for (let note = MIN_TUNING_NOTE; note <= MAX_TUNING_NOTE; note++) options.push(note);
  if (current < MIN_TUNING_NOTE) options.unshift(current);
  if (current > MAX_TUNING_NOTE) options.push(current);
  return options;
}

export function stringCountOptions(current: number): number[] {
  const options: number[] = [];
  for (let n = Math.min(MIN_STRINGS, current); n <= MAX_STRINGS; n++) options.push(n);
  return options;
}

const bars = (list: readonly number[]) => {
  const sorted = [...list].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let end = i;
    while (sorted[end + 1] === (sorted[end] ?? 0) + 1) end++;
    const first = sorted[i] ?? 0;
    const last = sorted[end] ?? first;
    parts.push(last === first ? String(first) : `${String(first)}–${String(last)}`);
    i = end + 1;
  }
  return `bar${sorted.length === 1 ? '' : 's'} ${parts.join(', ')}`;
};

/** For each string above `count` that still holds notes, the 1-based bars it sounds in. */
export function notesAboveString(track: Track, count: number): Map<number, number[]> {
  const found = new Map<number, number[]>();
  if (track.kind !== 'fretted') return found;
  track.bars.forEach((bar, index) => {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          if (note.string <= count) continue;
          const list = found.get(note.string) ?? [];
          if (!list.includes(index + 1)) list.push(index + 1);
          found.set(note.string, list);
        }
      }
    }
  });
  return found;
}

/** The refusal for dropping strings that hold notes, naming strings and bars; undefined when none do. */
export function droppedStringsMessage(track: Track, count: number): string | undefined {
  const found = notesAboveString(track, count);
  if (found.size === 0) return undefined;
  return [...found.entries()]
    .sort(([a], [b]) => a - b)
    .map(([string, where]) => `String ${String(string)} has notes in ${bars(where)}`)
    .join('; ');
}

export function validateTrackForm(form: TrackForm, existing?: Track): TrackFormErrors {
  const errors: TrackFormErrors = {};
  // An imported track may have no name; leaving it that way is not an error, only typing it away.
  if (form.name.trim() === '' && existing?.name !== '') errors.name = 'Give the track a name.';
  if (form.shortName.trim() === '' && existing?.shortName !== '') {
    errors.shortName = 'Give the track a short name.';
  }
  if (!HEX_COLOR.test(form.color)) errors.color = 'Use a six-digit hex colour, such as a swatch.';
  if (form.kind === 'fretted') {
    const fretCount = existing?.fretCount ?? createTrack('fretted').fretCount;
    const capo = form.capo.trim();
    const value = Number(capo);
    if (capo === '' || !Number.isInteger(value) || value < 0 || value > fretCount) {
      errors.capo = `The capo is a whole number from 0 to ${String(fretCount)}.`;
    }
    if (form.strings.length < 1 || form.strings.length > MAX_STRINGS) {
      errors.strings = `A track has 1 to ${String(MAX_STRINGS)} strings.`;
    } else if (existing) {
      const refusal = droppedStringsMessage(existing, form.strings.length);
      if (refusal !== undefined) errors.strings = `${refusal}. Clear them before removing strings.`;
    }
  }
  return errors;
}

export const hasErrors = (errors: TrackFormErrors): boolean => Object.keys(errors).length > 0;

/** "6 to 3", "2 and 1", "1": the strings of one kind of course, highest number first. */
function stringRange(strings: readonly number[]): string {
  const sorted = [...strings].sort((a, b) => b - a);
  const first = sorted[0] ?? 0;
  const last = sorted.at(-1) ?? first;
  if (sorted.length === 1) return String(first);
  const run = first - last === sorted.length - 1;
  if (run && sorted.length > 2) return `${String(first)} to ${String(last)}`;
  return sorted.length === 2 ? `${String(first)} and ${String(last)}` : sorted.join(', ');
}

/**
 * The read-only line of the track dialog for doubled courses, "Doubled courses: octave on strings
 * 6 to 3, unison on strings 2 and 1"; `undefined` for single strings.
 */
export function coursesSummary(
  courses: readonly (number | null)[] | undefined,
): string | undefined {
  if (!courses) return undefined;
  const kinds: [number, string][] = [
    [12, 'octave'],
    [-12, 'octave below'],
    [0, 'unison'],
  ];
  const parts = kinds.flatMap(([offset, label]) => {
    const strings = courses.flatMap((value, index) => (value === offset ? [index + 1] : []));
    return strings.length === 0 ? [] : [`${label} on strings ${stringRange(strings)}`];
  });
  return parts.length === 0 ? undefined : `Doubled courses: ${parts.join(', ')}`;
}

const coursesKey = (courses: readonly (number | null)[] | undefined): string | undefined =>
  courses?.map((offset) => offset ?? 'single').join();

/** Only what differs from the track, for one `setTrackProperties`; empty when nothing changed. */
export function trackChanges(track: Track, form: TrackForm): TrackChanges {
  const changes: TrackChanges = {};
  const name = form.name.trim();
  const shortName = form.shortName.trim();
  const color = form.color.toLowerCase();
  // An imported name keeps its spacing until the user changes the text itself.
  if (name !== track.name.trim()) changes.name = name;
  if (shortName !== track.shortName.trim()) changes.shortName = shortName;
  if (color !== track.color) changes.color = color;
  if (form.program !== track.program) changes.program = form.program;
  if (track.kind === 'fretted') {
    const tuning = modelOrder(form.strings);
    if (tuning.join() !== track.tuning.join()) changes.tuning = tuning;
    // Tuning and courses go together: the model refuses courses of another length than the strings.
    const courses = form.courses && modelOrder(form.courses);
    if (coursesKey(courses) !== coursesKey(track.courses)) changes.courses = courses ?? null;
    if (form.drone?.string !== track.drone?.string || form.drone?.fret !== track.drone?.fret) {
      changes.drone = form.drone ?? null;
    }
    const capo = Number(form.capo);
    if (capo !== track.capo) changes.capo = capo;
  }
  return changes;
}

/** The properties for `addTrack`; strings and capo only for a fretted track. */
export function newTrackProperties(form: TrackForm, defaults: NotationDefaults): TrackProperties {
  const properties: TrackProperties = {
    name: form.name.trim(),
    shortName: form.shortName.trim(),
    color: form.color.toLowerCase(),
    program: form.program,
  };
  if (form.kind === 'fretted') {
    properties.tuning = modelOrder(form.strings);
    if (form.courses) properties.courses = modelOrder(form.courses);
    if (form.drone) properties.drone = form.drone;
    properties.capo = Number(form.capo);
    properties.display = {
      ...createTrack('fretted').display,
      notation: isVocalTrack({ kind: 'fretted', program: form.program, name: form.name })
        ? defaults.vocals
        : defaults.strings,
    };
  }
  return properties;
}

export const isEmptyChange = (changes: TrackChanges): boolean => Object.keys(changes).length === 0;

/** Whether the track holds any note, which decides if removing it asks first. */
export function trackHasNotes(score: Score, trackId: string): boolean {
  const track = score.tracks.find(({ id }) => id === trackId);
  return (
    track?.bars.some((bar) =>
      bar.voices.some((voice) => voice.beats.some((beat) => beat.notes.length > 0)),
    ) ?? false
  );
}

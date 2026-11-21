import {
  MAX_STRINGS,
  STANDARD_TUNINGS,
  createTrack,
  findTuningName,
  isVocalTrack,
  type Score,
  type Track,
  type TrackChanges,
  type TrackKind,
  type TrackProperties,
  type TuningInstrument,
} from '@reprise/model';

import type { NotationDefaults } from '@/state/notation-defaults';

/** Ten swatches that read on both themes, so a track keeps its colour when the theme flips. */
export const TRACK_COLORS: readonly string[] = [
  '#d9480f',
  '#1971c2',
  '#2f9e44',
  '#9c36b5',
  '#e03131',
  '#f08c00',
  '#0c8599',
  '#c2255c',
  '#5c7cfa',
  '#495057',
];

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
  capo: string;
  program: number;
  /** A name the user typed: a preset's default name never replaces it. */
  nameEdited: boolean;
  /** While false the short name follows the name. */
  shortNameEdited: boolean;
  programEdited: boolean;
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
    capo: String(track.capo),
    program: track.program,
    nameEdited: true,
    shortNameEdited: track.shortName !== shortNameOf(track.name),
    programEdited: true,
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
  };
}

/** Picking another kind starts again from its defaults, keeping a colour and a name the user typed. */
export function changeKind(form: TrackForm, kind: TrackKind): TrackForm {
  if (kind === form.kind) return form;
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

const modelOrder = (strings: readonly number[]) => [...strings].reverse();

/** The tuning table's name for the form's strings, or undefined for a custom tuning. */
export function presetNameOf(form: TrackForm): string | undefined {
  return findTuningName(modelOrder(form.strings));
}

/**
 * Chooses a table tuning, or leaves the strings as they are for `undefined` (Custom). When adding
 * a track, its instrument also renames, re-shortens and re-programs whatever the user has not
 * touched.
 */
export function applyPreset(form: TrackForm, name: string | undefined, adding: boolean): TrackForm {
  const preset = STANDARD_TUNINGS.find((tuning) => tuning.name === name);
  if (!preset) return form;
  let next: TrackForm = { ...form, strings: modelOrder(preset.strings) };
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
  if (count < current) return { ...form, strings: form.strings.slice(0, count) };
  const strings = [...form.strings];
  while (strings.length < count) {
    const lowest = strings.at(-1) ?? 40;
    strings.push(Math.max(0, lowest - NEW_STRING_INTERVAL));
  }
  return { ...form, strings };
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
  if (!HEX_COLOR.test(form.color)) errors.color = 'Use a colour like #d9480f.';
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

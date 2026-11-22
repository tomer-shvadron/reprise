import {
  createNote,
  storedFret,
  writtenFret,
  type Beat,
  type GraceBeat,
  type Id,
  type Note,
} from '@reprise/model';

import { effectTarget, type EffectTarget, type NoteRef } from './effect-targets';
import {
  effectCommand,
  effectSound,
  type EffectEdits,
  type EffectInput,
  type EffectResult,
} from './effects';

export const GRACE_DURATIONS = [16, 32, 64] as const;
export type GraceDuration = (typeof GRACE_DURATIONS)[number];

/** What links the grace note to the main note: nothing, a slide into it, or a hammer-on to it. */
export type GraceTransition = 'none' | 'slide' | 'hammer';

export interface GraceForm {
  /** Absolute fret of the grace note, as the tab shows it: a neck fret on a banjo's drone string. */
  fret: number;
  duration: GraceDuration;
  /** Before the beat's time position, or on it (stealing from the beat). */
  before: boolean;
  transition: GraceTransition;
  dead: boolean;
}

const NOTHING_SELECTED = 'Select a note first';
const FRETTED_ONLY = 'That effect needs a fretted track';

/** The notes a grace note is written for, grouped by beat: the notes picked, else all of the beat's. */
function graceTargets(target: EffectTarget): { notes: NoteRef[]; hasGrace: boolean }[] {
  return target.beats.map((beat) => {
    const picked = target.notes.filter((ref) => !ref.grace && ref.beat.id === beat.beat.id);
    const notes =
      picked.length > 0
        ? picked
        : beat.beat.notes.map((note): NoteRef => ({ ...beat, note, grace: false }));
    return { notes, hasGrace: (beat.beat.grace?.length ?? 0) > 0 };
  });
}

/** Why a grace note cannot go on the target, or undefined when it can. */
export function graceBlocker(
  input: EffectInput,
  target: EffectTarget = effectTarget(input),
): string | undefined {
  if (target.beats.length === 0) return NOTHING_SELECTED;
  if (target.beats.every((beat) => beat.track.kind !== 'fretted')) return FRETTED_ONLY;
  return undefined;
}

/**
 * The form the dialog opens on. A target that already has grace notes shows the first one's
 * values and offers Remove; otherwise the fret is two below the first target note, which is the
 * usual approach note, and never below the open string. The transition is read from the beat the
 * grace notes are on.
 */
export function defaultGraceForm(
  input: EffectInput,
  before: boolean,
): { form: GraceForm; existing: boolean } {
  const target = effectTarget(input);
  const groups = graceTargets(target);
  const firstIndex = groups.findIndex((group) => group.notes.length > 0);
  const first = groups[firstIndex]?.notes[0];
  const firstTrack = target.beats[firstIndex]?.track;
  const owner = target.beats.find((beat) => (beat.beat.grace?.length ?? 0) > 0);
  const existing = owner?.beat.grace?.[0];
  const graceNote = existing?.notes[0];
  if (owner && existing && graceNote) {
    return {
      existing: true,
      form: {
        fret: owner.track.kind === 'fretted' ? writtenFret(owner.track, graceNote) : graceNote.fret,
        duration: existing.duration,
        before: existing.before,
        transition: graceNote.slide?.includes('shift')
          ? 'slide'
          : owner.beat.notes.some((note) => note.hammerPull && note.string === graceNote.string)
            ? 'hammer'
            : 'none',
        dead: graceNote.dead,
      },
    };
  }
  const approach = Math.max(
    0,
    (first && firstTrack?.kind === 'fretted'
      ? writtenFret(firstTrack, first.note)
      : (first?.note.fret ?? 2)) - 2,
  );
  // On a drone string the frets just under its first one do not exist, so the approach is open.
  const fret =
    first &&
    firstTrack?.kind === 'fretted' &&
    storedFret(firstTrack, first.note.string, approach) === undefined
      ? 0
      : approach;
  return {
    existing: false,
    form: {
      fret,
      duration: 32,
      before,
      transition: 'none',
      dead: false,
    },
  };
}

/** Whether the form's fret is a whole number the model can hold; the neck's own limit is the model's. */
export function graceFretError(fret: unknown): string | undefined {
  return typeof fret === 'number' && Number.isInteger(fret) && fret >= 0 && fret <= 127
    ? undefined
    : 'Enter a fret from 0 to 127';
}

const graceStrings = (grace: readonly GraceBeat[] | undefined): Set<number> =>
  new Set((grace ?? []).flatMap((g) => g.notes.map((n) => n.string)));

/**
 * While a grace note is on a string, `hammerPull` on that string's main note can only mean "from
 * the grace note", so the dialog owns it: the notes of `strings` get `wanted`, and a note whose
 * flag already matches is not written. Strings that lost their grace note get it cleared.
 */
function hammerEdits(
  beat: Beat,
  wanted: ReadonlyMap<number, boolean>,
): { noteId: Id; effects: { hammerPull: boolean } }[] {
  return beat.notes
    .filter((note) => wanted.has(note.string) && note.hammerPull !== wanted.get(note.string))
    .map((note) => ({
      noteId: note.id,
      effects: { hammerPull: wanted.get(note.string) === true },
    }));
}

/**
 * The command that gives each target beat one grace beat, with a grace note on every targeted
 * string at the form's fret, replacing any grace notes already there. The transition owns
 * `hammerPull` on those strings' main notes (on for a hammer-on, which is what layout and audio
 * read, off otherwise) and a slide puts a shift slide on the grace note. `'remove'` clears the
 * grace notes of every target beat and the flag they owned. One undo step.
 */
export function planGrace(input: EffectInput, form: GraceForm | 'remove'): EffectResult {
  const blocked = graceBlocker(input);
  if (blocked !== undefined) return { refused: blocked };
  const target = effectTarget(input);
  const groups = graceTargets(target);
  if (form === 'remove') {
    const withGrace = target.beats.filter((beat) => (beat.beat.grace?.length ?? 0) > 0);
    const beats = withGrace.map((beat) => ({ beatId: beat.beat.id, changes: { grace: null } }));
    const notes = withGrace.flatMap(({ beat }) =>
      hammerEdits(beat, new Map([...graceStrings(beat.grace)].map((string) => [string, false]))),
    );
    if (beats.length === 0) return { nothing: true };
    const beatSound = effectSound(input.score, { beats }, input.state.cursor?.track);
    return {
      command: effectCommand('Remove grace note', { beats, notes }),
      ...(beatSound && { beatSound }),
    };
  }
  // The form's fret is the one the tab shows; the drone string stores its frets from its own nut.
  for (const [index, beat] of target.beats.entries()) {
    if (beat.track.kind !== 'fretted') continue;
    for (const { note } of groups[index]?.notes ?? []) {
      if (storedFret(beat.track, note.string, form.fret) === undefined) {
        const first = (beat.track.drone?.fret ?? 0) + 1;
        return {
          refused: `String ${String(note.string)} has no frets 1 to ${String(first - 1)}: use 0, or ${String(first)} and up`,
        };
      }
    }
  }
  const beats: NonNullable<EffectEdits['beats']>[number][] = [];
  const notes: NonNullable<EffectEdits['notes']>[number][] = [];
  target.beats.forEach((beat, index) => {
    const refs = groups[index]?.notes ?? [];
    if (beat.track.kind !== 'fretted' || refs.length === 0) return;
    const graceNotes: Note[] = refs.map(({ note }) =>
      createNote({
        string: note.string,
        fret: storedFret(beat.track, note.string, form.fret) ?? form.fret,
        dead: form.dead,
        ...(form.transition === 'slide' && { slide: ['shift' as const] }),
      }),
    );
    const grace: GraceBeat = { duration: form.duration, before: form.before, notes: graceNotes };
    beats.push({ beatId: beat.beat.id, changes: { grace: [grace] } });
    const wanted = new Map<number, boolean>();
    for (const string of graceStrings(beat.beat.grace)) wanted.set(string, false);
    for (const { note } of refs) wanted.set(note.string, form.transition === 'hammer');
    notes.push(...hammerEdits(beat.beat, wanted));
  });
  if (beats.length === 0) return { refused: FRETTED_ONLY };
  const beatSound = effectSound(input.score, { beats }, input.state.cursor?.track);
  return {
    command: effectCommand('Grace note', { beats, notes }),
    ...(beatSound && { beatSound }),
  };
}

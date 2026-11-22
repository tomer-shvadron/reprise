import type { Beat, BeatEffects, BendPoint, Note, TrackKind, Whammy } from '@reprise/model';

import { rhythmTicks, type Rhythm } from './rhythm';

const END_SLIDES = new Set(['shift', 'legato', 'outDown', 'outUp']);

/** The slide kinds that belong at the start of a note (they play into it), or at its end. */
function slidesOf(note: Note, keep: (kind: string) => boolean): Note['slide'] {
  const kept = note.slide?.filter(keep);
  return kept && kept.length > 0 ? kept : undefined;
}

function withSlide(note: Note, slide: Note['slide']): Note {
  const copy = { ...note };
  delete copy.slide;
  return slide ? { ...copy, slide } : copy;
}

/** The first piece keeps the attack of the note and hands the end of it to the last piece. */
function firstNote(note: Note): Note {
  return {
    ...withSlide(
      note,
      slidesOf(note, (kind) => !END_SLIDES.has(kind)),
    ),
    staccato: false,
  };
}

/**
 * A continuation sounds on as a tied note. It is never dead or bent, and it carries no attack
 * marks. Vibrato goes on only when the note does not bend, because a vibrato on a link would stop
 * the span `bendTerm` draws over the bare links after a bend.
 */
function continuation(note: Note, last: boolean, endSlide: Note['slide']): Note {
  const rest = { ...note };
  delete rest.bend;
  delete rest.slide;
  delete rest.pickScrape;
  delete rest.leftHandFinger;
  delete rest.rightHandFinger;
  return {
    ...rest,
    tie: true,
    dead: false,
    ghost: false,
    accent: 'none',
    staccato: last && note.staccato,
    hammerPull: false,
    vibrato: note.bend ? 'none' : note.vibrato,
    ...(last && endSlide && { slide: endSlide }),
  };
}

/** The value of the curve at `position` (0 to 60), straight between its points. */
function valueAt(points: readonly BendPoint[], position: number): number {
  const sorted = [...points].sort((a, b) => a.position - b.position);
  const head = sorted[0];
  const tail = sorted.at(-1);
  if (!head || !tail) return 0;
  if (position <= head.position) return head.value;
  if (position >= tail.position) return tail.value;
  for (let i = 1; i < sorted.length; i++) {
    const to = sorted[i];
    const from = sorted[i - 1];
    if (!to || !from || position > to.position) continue;
    const span = to.position - from.position;
    return span === 0
      ? to.value
      : from.value + ((to.value - from.value) * (position - from.position)) / span;
  }
  return tail.value;
}

/** The part of a whammy curve between two fractions of the beat, as a curve of its own over 0 to 60. */
function whammySlice(whammy: Whammy, from: number, to: number): Whammy {
  const start = from * 60;
  const end = to * 60;
  const inside = whammy.points.filter(({ position }) => position > start && position < end);
  const points: BendPoint[] = [
    { position: 0, value: valueAt(whammy.points, start) },
    ...inside.map(({ position, value }) => ({
      position: ((position - start) / (end - start)) * 60,
      value,
    })),
    { position: 60, value: valueAt(whammy.points, end) },
  ];
  return { kind: 'custom', points };
}

const flat = (whammy: Whammy): boolean => {
  const [head] = whammy.points;
  return whammy.points.every(({ value }) => value === head?.value);
};

/**
 * The beat as a run of tied beats of these note values, one per value: the first is the beat as
 * it was, every later one holds the same notes on with `tie: true`. Each field goes where
 * playback reads it from a tie chain, so the split note sounds as it did (a bend stays on the
 * first piece and spans the links, a legato slide moves to the last). A rest splits into rests,
 * and on a drum track every piece after the first is a rest, since a hit holds no length.
 * Ids are copied: the caller gives every beat a fresh one.
 */
export function splitBeat(beat: Beat, values: readonly Rhythm[], kind: TrackKind): Beat[] {
  const total = values.reduce((sum, value) => sum + rhythmTicks(value), 0);
  const pitched = !beat.rest && beat.notes.length > 0;
  const { fadeOut, whammy, vibrato, tremoloPicking, ...attack } = beat.effects;
  const bends = beat.notes.some((note) => note.bend);
  let elapsed = 0;
  let previousEnd = 0;
  return values.map((value, index): Beat => {
    const first = index === 0;
    const last = index === values.length - 1;
    const from = elapsed / total;
    elapsed += rhythmTicks(value);
    const to = elapsed / total;
    const piece: Beat = {
      id: beat.id,
      duration: value.duration,
      dots: value.dots,
      rest: beat.rest,
      notes: [],
      effects: {},
    };
    if (value.tuplet) piece.tuplet = value.tuplet;
    if (kind === 'drums') {
      return first
        ? { ...beat, ...piece, notes: beat.notes, effects: beat.effects }
        : { ...piece, rest: true };
    }
    if (!first && !pitched) return piece;
    const effects: BeatEffects = first ? { ...attack } : {};
    if (tremoloPicking !== undefined) effects.tremoloPicking = tremoloPicking;
    if (vibrato !== undefined && (first || !bends)) effects.vibrato = vibrato;
    if (fadeOut && last) effects.fadeOut = true;
    if (whammy) {
      const slice = whammySlice(whammy, from, to);
      // A flat slice that continues the last one is dropped: the value before it holds.
      const holds = !first && flat(slice) && slice.points[0]?.value === previousEnd;
      if (!holds) effects.whammy = slice;
      previousEnd = slice.points.at(-1)?.value ?? 0;
    }
    if (first) {
      return {
        ...piece,
        notes: beat.notes.map(firstNote),
        effects,
        ...(beat.text !== undefined && { text: beat.text }),
        ...(beat.chord && { chord: beat.chord }),
        ...(beat.grace && { grace: beat.grace }),
        ...(beat.mix && { mix: beat.mix }),
        ...(beat.lyrics && { lyrics: beat.lyrics }),
      };
    }
    return {
      ...piece,
      notes: beat.notes.map((note) =>
        continuation(
          note,
          last,
          slidesOf(note, (slide) => END_SLIDES.has(slide)),
        ),
      ),
      effects,
    };
  });
}

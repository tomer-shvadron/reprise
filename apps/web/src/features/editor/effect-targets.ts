import type { Beat, Id, Note, Score, Track } from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { SelectionState } from '@/state/selection';

import { editTarget } from './range';

/** A note an effect can act on, with where it sits. */
export interface NoteRef {
  note: Note;
  beat: Beat;
  track: Track;
  /** Index into `score.tracks`. */
  trackIndex: number;
  /** Index into `score.masterBars`. */
  bar: number;
  voice: number;
  /** Index among the voice's beats. */
  index: number;
  /** A grace note, which has no beat position of its own and no neighbour on its string. */
  grace: boolean;
}

export interface BeatRef {
  beat: Beat;
  track: Track;
  trackIndex: number;
  bar: number;
  voice: number;
  index: number;
}

export interface EffectTarget {
  /** The notes picked, plus every main note of the beats picked (D7), grace notes only when picked. */
  notes: NoteRef[];
  /** The beats picked and the beats of the notes picked; rests (see `rests`) and empty beats are left out. */
  beats: BeatRef[];
  /** Rests picked or under the cursor, for the beat effects a rest can carry (golpe, wah). */
  rests: BeatRef[];
  /** Every main note of `beats`: what an effect on the whole beat reaches. */
  beatNotes: NoteRef[];
}

export interface EffectTargetInput {
  score: Score;
  state: Pick<SelectionState, 'cursor' | 'range' | 'selection'>;
  visible?: readonly Id[];
}

function beatRef(score: Score, id: Id): BeatRef | undefined {
  const info = scoreIndex(score).beats.get(id);
  const track = info && score.tracks[info.trackIndex];
  const beat = info && track?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index];
  if (!info || !track || !beat) return undefined;
  return {
    beat,
    track,
    trackIndex: info.trackIndex,
    bar: info.masterBarIndex,
    voice: info.voice,
    index: info.index,
  };
}

const mainNotes = (ref: BeatRef): NoteRef[] =>
  ref.beat.notes.map((note) => ({ ...ref, note, grace: false }));

/**
 * What an effect command acts on, resolved from the same `editTarget` that entry uses: the
 * range's beats, else the notes picked, else the note under the cursor, else its beat. A note
 * effect goes on the notes picked, or on every note of the beats picked; a beat effect goes on
 * the beats, and on the beats of the notes picked.
 */
export function effectTarget(input: EffectTargetInput): EffectTarget {
  const { score } = input;
  const selection = editTarget(score, input.state, input.visible);
  const index = scoreIndex(score);
  const beats = new Map<Id, BeatRef>();
  const rests = new Map<Id, BeatRef>();
  const addBeat = (id: Id) => {
    if (beats.has(id) || rests.has(id)) return;
    const ref = beatRef(score, id);
    if (!ref) return;
    if (ref.beat.rest) rests.set(id, ref);
    else if (ref.beat.notes.length > 0) beats.set(id, ref);
  };
  const notes = new Map<Id, NoteRef>();
  for (const id of selection.beatIds ?? []) {
    addBeat(id);
    const ref = beats.get(id);
    if (ref) for (const note of mainNotes(ref)) notes.set(note.note.id, note);
  }
  for (const id of selection.noteIds ?? []) {
    const owner = index.noteBeat.get(id);
    const ref = owner === undefined ? undefined : beatRef(score, owner);
    if (!owner || !ref || ref.beat.rest) continue;
    const main = ref.beat.notes.find((note) => note.id === id);
    const grace = ref.beat.grace?.flatMap((g) => g.notes).find((note) => note.id === id);
    const found = main ?? grace;
    if (!found) continue;
    addBeat(owner);
    notes.set(id, { ...ref, note: found, grace: main === undefined });
  }
  const beatList = [...beats.values()];
  return {
    notes: [...notes.values()],
    beats: beatList,
    rests: [...rests.values()],
    beatNotes: beatList.flatMap(mainNotes),
  };
}

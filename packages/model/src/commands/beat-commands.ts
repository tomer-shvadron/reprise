import { BeatSchema } from '../beat';
import type { Beat, BeatEffects, GraceBeat } from '../beat';
import { createBeat } from '../factories';
import type { Command } from '../history';
import { newId } from '../id';
import type { Id } from '../id';
import type { Note } from '../note';
import type { Score } from '../score';
import { assignChanges } from './changes';
import type { Changes } from './changes';
import { assertFreshId, assertTrackValid, parseOrThrow, releaseTies } from './checks';
import { CommandError } from './command-error';
import { at, beatAt, findBeat, findVoice } from './locate';

export type BeatInput = Partial<Omit<Beat, 'id'>>;

export type BeatRhythm = Pick<Beat, 'duration' | 'dots' | 'tuplet'>;

/** Beat-level effects, plus the beat's text, chord, lyrics, mixer change and grace notes. */
export type BeatChanges = { effects?: Changes<BeatEffects> } & Changes<
  Pick<Beat, 'text' | 'chord' | 'lyrics' | 'mix' | 'grace'>
>;

function graceNotes(grace: readonly GraceBeat[] | undefined): Note[] {
  return grace?.flatMap((g) => g.notes) ?? [];
}

function assertFreshNotes(draft: Score, notes: readonly Note[], command: string): void {
  const ids = new Set<Id>();
  for (const note of notes) {
    if (ids.has(note.id)) {
      throw new CommandError(command, 'duplicate-id', `id ${note.id} is used twice`);
    }
    ids.add(note.id);
    assertFreshId(draft, note.id, command);
  }
}

/** Inserts a beat into a voice at `index`; by default a quarter rest, or a played beat when given notes. */
export function insertBeat(
  target: { voiceId: Id; index: number; id?: Id },
  beat: BeatInput = {},
): Command {
  const name = 'insertBeat';
  return {
    name,
    run(draft) {
      const where = findVoice(draft, target.voiceId, name);
      const track = at(draft.tracks, where.track, name);
      const voice = at(at(track.bars, where.bar, name).voices, where.voice, name);
      if (
        !Number.isInteger(target.index) ||
        target.index < 0 ||
        target.index > voice.beats.length
      ) {
        throw new CommandError(
          name,
          'invalid-value',
          `index ${String(target.index)} is outside 0 to ${String(voice.beats.length)}`,
        );
      }
      if (target.id !== undefined) assertFreshId(draft, target.id, name);
      assertFreshNotes(draft, [...(beat.notes ?? []), ...graceNotes(beat.grace)], name);
      const node = parseOrThrow(
        BeatSchema,
        {
          ...createBeat({ rest: (beat.notes?.length ?? 0) === 0, ...beat }),
          id: target.id ?? newId(),
        },
        name,
      );
      voice.beats.splice(target.index, 0, node);
      releaseTies(track, where.bar, where.voice, target.index + 1);
      assertTrackValid(draft, where.track, name);
    },
  };
}

export function removeBeat(target: { beatId: Id }): Command {
  const name = 'removeBeat';
  return {
    name,
    run(draft) {
      const position = findBeat(draft, target.beatId, name);
      const track = at(draft.tracks, position.track, name);
      const voice = at(at(track.bars, position.bar, name).voices, position.voice, name);
      voice.beats.splice(position.beat, 1);
      releaseTies(track, position.bar, position.voice, position.beat);
    },
  };
}

/** Sets the note value, dots and tuplet (`null` removes it); refuses to overfill the voice. */
export function setBeatDuration(target: { beatId: Id }, rhythm: Changes<BeatRhythm>): Command {
  const name = 'setBeatDuration';
  return {
    name,
    run(draft) {
      const position = findBeat(draft, target.beatId, name);
      const beat = beatAt(draft, position, name);
      assignChanges(beat, rhythm);
      parseOrThrow(BeatSchema, beat, name);
      assertTrackValid(draft, position.track, name);
    },
  };
}

/** `true` makes the beat a rest and drops its notes; `false` leaves an empty, unfilled beat. */
export function setBeatRest(target: { beatId: Id }, rest: boolean): Command {
  const name = 'setBeatRest';
  return {
    name,
    run(draft) {
      const position = findBeat(draft, target.beatId, name);
      const track = at(draft.tracks, position.track, name);
      const beat = beatAt(draft, position, name);
      beat.rest = rest;
      if (!rest || beat.notes.length === 0) return;
      beat.notes = [];
      releaseTies(track, position.bar, position.voice, position.beat + 1);
    },
  };
}

export function setBeatEffect(target: { beatId: Id }, changes: BeatChanges): Command {
  const name = 'setBeatEffect';
  return {
    name,
    run(draft) {
      const position = findBeat(draft, target.beatId, name);
      const beat = beatAt(draft, position, name);
      const { effects, ...properties } = changes;
      if (properties.grace) {
        const kept = new Set(graceNotes(beat.grace).map((note) => note.id));
        assertFreshNotes(
          draft,
          graceNotes(properties.grace).filter((note) => !kept.has(note.id)),
          name,
        );
      }
      if (effects) assignChanges(beat.effects, effects);
      assignChanges(beat, properties);
      parseOrThrow(BeatSchema, beat, name);
      assertTrackValid(draft, position.track, name);
    },
  };
}

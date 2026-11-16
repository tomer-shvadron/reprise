import { BeatSchema } from '../beat';
import type { Beat, BeatEffects, GraceBeat } from '../beat';
import { createBeat } from '../factories';
import type { Command } from '../history';
import { newId } from '../id';
import type { Id } from '../id';
import type { Note } from '../note';
import type { Score } from '../score';
import type { Track } from '../track';
import { assignChanges } from './changes';
import type { Changes } from './changes';
import {
  assertFreshId,
  assertFreshIds,
  assertNotePlaced,
  assertTrackValid,
  forTarget,
  parseOrThrow,
  releaseTies,
} from './checks';
import { CommandError } from './command-error';
import { at, baseOf, beatAt, findBeat, findVoice, indexBeats } from './locate';
import type { BeatAt } from './locate';

export type BeatInput = Partial<Omit<Beat, 'id'>>;

export type BeatRhythm = Pick<Beat, 'duration' | 'dots' | 'tuplet'>;

/** Beat-level effects, plus the beat's text, chord, lyrics, mixer change and grace notes. */
export type BeatChanges = { effects?: Changes<BeatEffects> } & Changes<
  Pick<Beat, 'text' | 'chord' | 'lyrics' | 'mix' | 'grace'>
>;

function graceNotes(grace: readonly GraceBeat[] | undefined): Note[] {
  return grace?.flatMap((g) => g.notes) ?? [];
}

/** Notes a command adds get the full placement check, ids included; the count-based check cannot see them as new. */
function assertNewNotes(draft: Score, track: Track, notes: readonly Note[], command: string): void {
  assertFreshIds(
    draft,
    notes.map((note) => note.id),
    command,
  );
  for (const note of notes) assertNotePlaced(track, note, command);
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
      assertNewNotes(draft, track, [...(beat.notes ?? []), ...graceNotes(beat.grace)], name);
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

/** The grace notes `changes` adds to the beat: those whose ids the beat does not already hold. */
function addedGraceNotes(draft: Score, position: BeatAt, changes: BeatChanges, name: string) {
  if (!changes.grace) return [];
  const kept = new Set(graceNotes(beatAt(baseOf(draft), position, name).grace).map((n) => n.id));
  return graceNotes(changes.grace).filter((note) => !kept.has(note.id));
}

/** Applies one beat's changes on the draft; the caller checks new ids and validates the track. */
function applyBeatChanges(draft: Score, position: BeatAt, changes: BeatChanges, name: string) {
  const beat = beatAt(draft, position, name);
  const { effects, ...properties } = changes;
  if (effects) assignChanges(beat.effects, effects);
  assignChanges(beat, properties);
  parseOrThrow(BeatSchema, beat, name);
}

export function setBeatEffect(target: { beatId: Id }, changes: BeatChanges): Command {
  const name = 'setBeatEffect';
  return {
    name,
    run(draft) {
      const position = findBeat(draft, target.beatId, name);
      assertNewNotes(
        draft,
        at(draft.tracks, position.track, name),
        addedGraceNotes(draft, position, changes, name),
        name,
      );
      applyBeatChanges(draft, position, changes, name);
      assertTrackValid(draft, position.track, name);
    },
  };
}

export interface BeatEffectEdit {
  beatId: Id;
  changes: BeatChanges;
}

/**
 * `setBeatEffect` for many beats at once: one lookup pass, one draft, each touched track
 * validated once, one history step, and atomic. An empty list or a beat named twice is refused.
 */
export function setBeatEffects(edits: readonly BeatEffectEdit[]): Command {
  const name = 'setBeatEffects';
  return {
    name,
    run(draft) {
      if (edits.length === 0) {
        throw new CommandError(name, 'invalid-value', 'no beat effect edits');
      }
      const seen = new Set<Id>();
      for (const { beatId } of edits) {
        if (seen.has(beatId)) {
          throw new CommandError(name, 'invalid-value', `beat ${beatId} is edited twice`);
        }
        seen.add(beatId);
      }
      const positions = indexBeats(draft, [...seen], name);
      const tracks = new Set<number>();
      const added: { track: Track; note: Note }[] = [];
      const located = edits.map(({ beatId, changes }) => {
        const position = positions.get(beatId);
        if (!position) throw new CommandError(name, 'not-found', `no beat ${beatId}`);
        const track = at(draft.tracks, position.track, name);
        for (const note of addedGraceNotes(draft, position, changes, name)) {
          added.push({ track, note });
        }
        return { beatId, position, changes };
      });
      // One walk for every new id across all edits, so a grace array reused on two tracks is
      // refused as the chain would, and the cost stays proportional to the notes added.
      assertFreshIds(
        draft,
        added.map(({ note }) => note.id),
        name,
      );
      for (const { track, note } of added) assertNotePlaced(track, note, name);
      for (const { beatId, position, changes } of located) {
        forTarget(`beat ${beatId}`, name, () => {
          applyBeatChanges(draft, position, changes, name);
        });
        tracks.add(position.track);
      }
      for (const track of tracks) assertTrackValid(draft, track, name);
    },
  };
}

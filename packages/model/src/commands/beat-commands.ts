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
  assertBarsValid,
  assertFreshIds,
  assertNotePlaced,
  forTarget,
  parseOrThrow,
  releaseTies,
} from './checks';
import { CommandError } from './command-error';
import { at, baseOf, beatAt, findBeat, findVoice, indexBeats, indexVoices } from './locate';
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
      // One walk for the beat's own id and every new note, then the placement of each note.
      const notes = [...(beat.notes ?? []), ...graceNotes(beat.grace)];
      assertFreshIds(
        draft,
        [...(target.id === undefined ? [] : [target.id]), ...notes.map((note) => note.id)],
        name,
      );
      for (const note of notes) assertNotePlaced(track, note, name);
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
      assertBarsValid(draft, where.track, [where.bar], name);
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
      assertBarsValid(draft, position.track, [position.bar], name);
    },
  };
}

export interface BeatDurationEdit {
  beatId: Id;
  rhythm: Changes<BeatRhythm>;
}

/**
 * `setBeatDuration` for many beats at once, as `setBeatEffects` is to `setBeatEffect`: one
 * lookup pass, each touched track's bars validated once, one history step, atomic. Only the end
 * state is validated, so a batch that would overfill a voice midway but fits at the end is
 * accepted. An empty list or a beat named twice is refused.
 */
export function setBeatDurations(edits: readonly BeatDurationEdit[]): Command {
  const name = 'setBeatDurations';
  return {
    name,
    run(draft) {
      if (edits.length === 0) {
        throw new CommandError(name, 'invalid-value', 'no beat duration edits');
      }
      const seen = new Set<Id>();
      for (const { beatId } of edits) {
        if (seen.has(beatId)) {
          throw new CommandError(name, 'invalid-value', `beat ${beatId} is edited twice`);
        }
        seen.add(beatId);
      }
      const positions = indexBeats(draft, [...seen], name);
      const touched = new Map<number, Set<number>>();
      for (const { beatId, rhythm } of edits) {
        const position = positions.get(beatId);
        if (!position) throw new CommandError(name, 'not-found', `no beat ${beatId}`);
        forTarget(`beat ${beatId}`, name, () => {
          const beat = beatAt(draft, position, name);
          assignChanges(beat, rhythm);
          parseOrThrow(BeatSchema, beat, name);
        });
        const bars = touched.get(position.track) ?? new Set<number>();
        bars.add(position.bar);
        touched.set(position.track, bars);
      }
      for (const [track, bars] of touched) assertBarsValid(draft, track, bars, name);
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
      assertBarsValid(draft, position.track, [position.bar], name);
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
      const tracks = new Map<number, Set<number>>();
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
        const bars = tracks.get(position.track) ?? new Set<number>();
        bars.add(position.bar);
        tracks.set(position.track, bars);
      }
      for (const [track, bars] of tracks) assertBarsValid(draft, track, bars, name);
    },
  };
}

export interface BeatSpliceEdit {
  voiceId: Id;
  /** Where the splice starts: 0 to the voice's beat count. */
  index: number;
  /** How many beats from `index` on are removed first. */
  remove: number;
  /** The beats put in their place, with fresh ids throughout. */
  beats: readonly Beat[];
}

/**
 * Splices the beats of many voices at once, the batched `removeBeat` plus `insertBeat`: one
 * voice-index pass, one fresh-id walk over every new beat, note and grace note across the edits,
 * each touched track validated once, one history step, atomic. Every voice is spliced first, then
 * ties are released in a second pass, once per voice from its first splice's index, so the result
 * does not depend on the order of `edits`: a note whose origin a splice removed loses its tie,
 * and so does an orphan tie on a pasted beat (its origin is not the previous note on that
 * string), which `insertBeat` would refuse; a clip often starts with a tied note. An empty list,
 * two edits on one voice that overlap or share an index, and an index or count out of range are
 * refused as `invalid-value`.
 */
export function replaceBeats(edits: readonly BeatSpliceEdit[]): Command {
  const name = 'replaceBeats';
  return {
    name,
    run(draft) {
      if (edits.length === 0) {
        throw new CommandError(name, 'invalid-value', 'no beat splices');
      }
      const positions = indexVoices(draft, [...new Set(edits.map((e) => e.voiceId))], name);
      const base = baseOf(draft);
      const byVoice = new Map<Id, BeatSpliceEdit[]>();
      for (const edit of edits) {
        const where = positions.get(edit.voiceId);
        if (!where) throw new CommandError(name, 'not-found', `no voice ${edit.voiceId}`);
        const count = at(
          at(at(base.tracks, where.track, name).bars, where.bar, name).voices,
          where.voice,
          name,
        ).beats.length;
        forTarget(`voice ${edit.voiceId}`, name, () => {
          if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index > count) {
            throw new CommandError(
              name,
              'invalid-value',
              `index ${String(edit.index)} is outside 0 to ${String(count)}`,
            );
          }
          if (
            !Number.isInteger(edit.remove) ||
            edit.remove < 0 ||
            edit.index + edit.remove > count
          ) {
            throw new CommandError(
              name,
              'invalid-value',
              `cannot remove ${String(edit.remove)} beats from index ${String(edit.index)} of ${String(count)}`,
            );
          }
        });
        byVoice.set(edit.voiceId, [...(byVoice.get(edit.voiceId) ?? []), edit]);
      }
      for (const [voiceId, list] of byVoice) {
        const sorted = [...list].sort((a, b) => a.index - b.index);
        sorted.forEach((edit, i) => {
          const previous = sorted[i - 1];
          if (
            previous &&
            (edit.index === previous.index || edit.index < previous.index + previous.remove)
          ) {
            throw new CommandError(
              name,
              'invalid-value',
              `voice ${voiceId} has overlapping splices`,
            );
          }
        });
        byVoice.set(voiceId, sorted);
      }
      const added: { track: Track; notes: Note[] }[] = [];
      const ids: Id[] = [];
      for (const edit of edits) {
        const where = positions.get(edit.voiceId);
        if (!where) continue;
        const track = at(base.tracks, where.track, name);
        for (const beat of edit.beats) {
          const notes = [...beat.notes, ...graceNotes(beat.grace)];
          ids.push(beat.id, ...notes.map((note) => note.id));
          added.push({ track, notes });
        }
      }
      assertFreshIds(draft, ids, name);
      for (const { track, notes } of added) {
        for (const note of notes) assertNotePlaced(track, note, name);
      }
      const tracks = new Map<number, Set<number>>();
      const spliced: { track: Track; bar: number; voice: number; index: number }[] = [];
      for (const [voiceId, list] of byVoice) {
        const where = positions.get(voiceId);
        if (!where) continue;
        const track = at(draft.tracks, where.track, name);
        const voice = at(at(track.bars, where.bar, name).voices, where.voice, name);
        // Back to front, so each edit's index still means a position in the voice as it was.
        for (const edit of [...list].reverse()) {
          const parsed: Beat[] = [];
          forTarget(`voice ${voiceId}`, name, () => {
            for (const beat of edit.beats) parsed.push(parseOrThrow(BeatSchema, beat, name));
          });
          voice.beats.splice(edit.index, edit.remove, ...parsed);
        }
        spliced.push({
          track,
          bar: where.bar,
          voice: where.voice,
          index: at(list, 0, name).index,
        });
        const bars = tracks.get(where.track) ?? new Set<number>();
        bars.add(where.bar);
        tracks.set(where.track, bars);
      }
      // After every splice, so each release reads the end state whatever order the voices came in.
      for (const { track, bar, voice, index } of spliced) releaseTies(track, bar, voice, index);
      for (const [track, bars] of tracks) assertBarsValid(draft, track, bars, name);
    },
  };
}

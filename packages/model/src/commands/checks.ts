import { current, isDraft } from 'immer';
import type { z } from 'zod';

import type { Beat } from '../beat';
import type { Id } from '../id';
import type { MasterBar } from '../master-bar';
import type { Note } from '../note';
import type { Score } from '../score';
import type { Track } from '../track';
import { validateMasterBars, validateScore } from '../validate';
import type { Violation } from '../validate';
import { CommandError } from './command-error';
import { baseOf } from './locate';

function plainMasterBars(masterBars: MasterBar[]): MasterBar[] {
  return isDraft(masterBars) ? current(masterBars) : masterBars;
}

function plainTrack(track: Track): Track {
  return isDraft(track) ? current(track) : track;
}

/** Zod reads drafts as it reads plain objects, so nothing is copied out first. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, command: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.join('.') ?? '';
  throw new CommandError(command, 'invalid-value', `${where} ${issue?.message ?? 'is invalid'}`);
}

/**
 * Fails when the edit raised the count of any rule. Counting per rule, not matching paths,
 * tolerates violations an imported file already carried and indices an insert shifted.
 */
function assertNoNewViolations(command: string, before: Violation[], after: Violation[]): void {
  const counts = new Map<string, number>();
  for (const violation of before) counts.set(violation.rule, (counts.get(violation.rule) ?? 0) + 1);
  for (const violation of after) {
    const left = counts.get(violation.rule) ?? 0;
    if (left > 0) {
      counts.set(violation.rule, left - 1);
      continue;
    }
    const broken = after.filter((v) => v.rule === violation.rule);
    throw new CommandError(
      command,
      'invariant',
      `${violation.rule} at ${violation.path.join('.')}: ${violation.message}`,
      broken,
    );
  }
}

export function assertMasterBarsValid(draft: Score, command: string): void {
  assertNoNewViolations(
    command,
    validateMasterBars(baseOf(draft).masterBars),
    validateMasterBars(plainMasterBars(draft.masterBars)),
  );
}

function trackViolations(score: Score, track: Track | undefined, trackIndex: number): Violation[] {
  if (!track) return [];
  const shell: Score = { ...score, tracks: [track] };
  return validateScore(shell)
    .filter((violation) => violation.path[0] === 'tracks')
    .map((violation) => ({
      ...violation,
      path: ['tracks', trackIndex, ...violation.path.slice(2)],
    }));
}

/** Validates one track against the master bars, without walking the other tracks. */
export function assertTrackValid(
  draft: Score,
  trackIndex: number,
  command: string,
  isNew = false,
): void {
  const base = baseOf(draft);
  const after = { ...base, masterBars: plainMasterBars(draft.masterBars) };
  const draftTrack = draft.tracks[trackIndex];
  assertNoNewViolations(
    command,
    isNew ? [] : trackViolations(base, base.tracks[trackIndex], trackIndex),
    trackViolations(after, draftTrack && plainTrack(draftTrack), trackIndex),
  );
}

export function assertFreshId(score: Score, id: Id, command: string): void {
  if (containsId(baseOf(score), id)) {
    throw new CommandError(command, 'duplicate-id', `id ${id} is already used`);
  }
}

function containsId(score: Score, id: Id): boolean {
  const inNotes = (notes: Note[]): boolean => notes.some((note) => note.id === id);
  const inBeat = (beat: Beat): boolean =>
    beat.id === id ||
    inNotes(beat.notes) ||
    (beat.grace?.some((grace) => inNotes(grace.notes)) ?? false);
  return (
    score.id === id ||
    score.masterBars.some((masterBar) => masterBar.id === id) ||
    score.tracks.some(
      (track) =>
        track.id === id ||
        track.bars.some(
          (bar) =>
            bar.id === id ||
            bar.voices.some((voice) => voice.id === id || voice.beats.some(inBeat)),
        ),
    )
  );
}

function sameSlot(track: Track, a: Note, b: Note): boolean {
  return track.kind === 'fretted' ? a.string === b.string : a.fret === b.fret;
}

export function hasTieTarget(track: Track, note: Note, previous: Beat | undefined): boolean {
  return !!previous && !previous.rest && previous.notes.some((p) => sameSlot(track, p, note));
}

export function previousBeat(
  track: Track,
  bar: number,
  voice: number,
  beat: number,
): Beat | undefined {
  if (beat > 0) return track.bars[bar]?.voices[voice]?.beats[beat - 1];
  return track.bars[bar - 1]?.voices[voice]?.beats.at(-1);
}

/**
 * Clears `tie` on the notes of the beat now at `beat` (rolling into the next bar past the
 * voice's end) whose tie target an edit removed. A tie is a consequence of its neighbour, so
 * edits repair it rather than refuse.
 */
export function releaseTies(track: Track, bar: number, voice: number, beat: number): void {
  const beats = track.bars[bar]?.voices[voice]?.beats;
  if (!beats) return;
  const [b, i] = beat < beats.length ? [bar, beat] : [bar + 1, 0];
  const target = track.bars[b]?.voices[voice]?.beats[i];
  if (!target) return;
  const previous = previousBeat(track, b, voice, i);
  for (const note of target.notes) {
    if (note.tie && !hasTieTarget(track, note, previous)) note.tie = false;
  }
}

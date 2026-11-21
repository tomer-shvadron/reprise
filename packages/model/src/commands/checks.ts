import { current, isDraft } from 'immer';
import type { z } from 'zod';

import type { Id } from '../id';
import type { MasterBar } from '../master-bar';
import type { Note } from '../note';
import type { Score } from '../score';
import { TIE_REACH_BARS, hasTieOrigin } from '../ties';
import { maxStoredFret } from '../pitch';
import type { Track } from '../track';
import { BAR_RULE_REACH, validateMasterBars, validateScore, validateTrackBars } from '../validate';
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
 * tolerates violations an imported file already carried and indices an insert shifted; it
 * cannot tell a fixed violation from a new one of the same rule, so the nodes a command
 * creates are checked in full before this runs.
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

/**
 * `assertTrackValid` for a beat edit that touched only `bars` of one track: validates those bars,
 * plus the `BAR_RULE_REACH` bars after each (an edit can make or break a tie that far ahead),
 * before and after. Every per-bar rule reads only its own bar, its master bar and the track's
 * settings, except that the tie rules look back `BAR_RULE_REACH` bars, so the count of each rule
 * over the other bars cannot change. It does not run `duplicate-id`, `bar-count` or `track-kind`:
 * a command must send every id it writes through `assertFreshIds`, or refuse a repeat among them
 * itself (grace lists do, in `setBeatEffect(s)`), and no beat edit moves the other two. Because
 * only the checked bars are compared, a refusal names a violation among them and
 * `CommandError.violations` lists only those, not ones the file carries elsewhere.
 */
export function assertBarsValid(
  draft: Score,
  trackIndex: number,
  touchedBars: Iterable<number>,
  command: string,
): void {
  const base = baseOf(draft);
  const last = (base.tracks[trackIndex]?.bars.length ?? 0) - 1;
  const bars = new Set<number>();
  for (const bar of touchedBars) {
    for (let b = bar; b <= Math.min(bar + BAR_RULE_REACH, last); b++) bars.add(b);
  }
  const sorted = [...bars].sort((a, b) => a - b);
  const after = { ...base, masterBars: plainMasterBars(draft.masterBars) };
  const draftTrack = draft.tracks[trackIndex];
  after.tracks = base.tracks.slice();
  if (draftTrack) after.tracks[trackIndex] = plainTrack(draftTrack);
  assertNoNewViolations(
    command,
    validateTrackBars(base, trackIndex, sorted),
    validateTrackBars(after, trackIndex, sorted),
  );
}

/**
 * Guitar Pro numbers frets up to the neck length whatever the capo; `transpose` and `fret-range`
 * use the same bound. The drone string stores frets from its own nut, so its ceiling is lower.
 */
export function maxFret(track: Track, string: number): number {
  return maxStoredFret(track, string);
}

export function assertNotePlaced(
  track: Track,
  note: Pick<Note, 'string' | 'fret'>,
  command: string,
): void {
  if (track.kind !== 'fretted') {
    if (note.string !== 0) {
      throw new CommandError(
        command,
        'invalid-value',
        `notes on a ${track.kind} track use string 0`,
      );
    }
    return;
  }
  const strings = track.tuning.length;
  if (note.string < 1 || note.string > strings) {
    throw new CommandError(
      command,
      'invalid-value',
      `string ${String(note.string)} is outside 1 to ${String(strings)}`,
    );
  }
  if (note.fret < 0 || note.fret > maxFret(track, note.string)) {
    throw new CommandError(
      command,
      'off-fretboard',
      `fret ${String(note.fret)} is outside 0 to ${String(maxFret(track, note.string))}`,
    );
  }
}

/**
 * Runs one edit of a batch and names its target in a refusal, so a status line can say which of
 * hundreds of edits failed: the message gains a `label: ` prefix, the code and violations stay.
 */
export function forTarget(label: string, command: string, edit: () => void): void {
  try {
    edit();
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    const own = `${error.command}: `;
    const message = error.message.startsWith(own) ? error.message.slice(own.length) : error.message;
    throw new CommandError(command, error.code, `${label}: ${message}`, error.violations);
  }
}

export function assertFreshId(score: Score, id: Id, command: string): void {
  assertFreshIds(score, [id], command);
}

/**
 * Refuses with `duplicate-id` when `ids` repeat each other or an id the score already uses, as a
 * chain of single commands would. One plain walk of the score tests each node against the small
 * set of wanted ids, so a batch costs one scan and no set of every id in the score.
 */
export function assertFreshIds(score: Score, ids: readonly Id[], command: string): void {
  if (ids.length === 0) return;
  const wanted = new Set(ids);
  const used = new Set<Id>();
  const base = baseOf(score);
  const check = (id: Id): void => {
    if (wanted.has(id)) used.add(id);
  };
  check(base.id);
  for (const masterBar of base.masterBars) check(masterBar.id);
  for (const track of base.tracks) {
    check(track.id);
    for (const bar of track.bars) {
      check(bar.id);
      for (const voice of bar.voices) {
        check(voice.id);
        for (const beat of voice.beats) {
          check(beat.id);
          for (const note of beat.notes) check(note.id);
          if (beat.grace) {
            for (const grace of beat.grace) for (const note of grace.notes) check(note.id);
          }
        }
      }
    }
  }
  // In order of `ids`, so the id a refusal names is the first one a chain would have refused.
  const seen = new Set<Id>();
  for (const id of ids) {
    if (used.has(id) || seen.has(id)) {
      throw new CommandError(command, 'duplicate-id', `id ${id} is already used`);
    }
    seen.add(id);
  }
}

/**
 * Clears `tie` on every tied note whose origin an edit removed, moved to another pitch or put out
 * of reach, from `beat` of `bar` to the end of the bar `TIE_REACH_BARS` after `lastBar`: the
 * furthest a tie reaching back into the edited span can sit. A tie is a consequence of its
 * neighbours, so edits repair it rather than refuse.
 */
export function releaseTies(
  track: Track,
  bar: number,
  voice: number,
  beat: number,
  lastBar = bar,
): void {
  const last = Math.min(lastBar + TIE_REACH_BARS, track.bars.length - 1);
  let start = beat;
  for (let b = bar; b <= last; b++) {
    const beats = track.bars[b]?.voices[voice]?.beats ?? [];
    for (let i = start; i < beats.length; i++) {
      for (const note of beats[i]?.notes ?? []) {
        if (note.tie && !hasTieOrigin(track, { bar: b, voice, beat: i }, note)) note.tie = false;
      }
    }
    start = 0;
  }
}

/** `releaseTies` once per track and voice, over the span from the first edited beat to the last. */
export function releaseTiesAfter(
  edits: readonly { track: Track; bar: number; voice: number; beat: number }[],
): void {
  const spans = new Map<Track, Map<number, { bar: number; beat: number; lastBar: number }>>();
  for (const { track, bar, voice, beat } of edits) {
    const voices =
      spans.get(track) ?? new Map<number, { bar: number; beat: number; lastBar: number }>();
    spans.set(track, voices);
    const span = voices.get(voice);
    if (!span) {
      voices.set(voice, { bar, beat, lastBar: bar });
      continue;
    }
    if (bar < span.bar || (bar === span.bar && beat < span.beat)) {
      span.bar = bar;
      span.beat = beat;
    }
    span.lastBar = Math.max(span.lastBar, bar);
  }
  for (const [track, voices] of spans) {
    for (const [voice, { bar, beat, lastBar }] of voices) {
      releaseTies(track, bar, voice, beat, lastBar);
    }
  }
}

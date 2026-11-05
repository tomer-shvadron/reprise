import { isDraft, original } from 'immer';

import type { Id } from '../id';
import type { Score } from '../score';
import { CommandError } from './command-error';

export interface BeatAt {
  track: number;
  bar: number;
  voice: number;
  beat: number;
}

export interface NoteAt extends BeatAt {
  note: number;
}

/**
 * Lookups walk the base score rather than the draft: reading the draft would create a proxy
 * for every node visited. Locate before mutating, then navigate the draft by index.
 */
export function baseOf(score: Score): Score {
  return isDraft(score) ? original(score) : score;
}

export function findBeat(score: Score, beatId: Id, command: string): BeatAt {
  const base = baseOf(score);
  for (const [t, track] of base.tracks.entries()) {
    for (const [b, bar] of track.bars.entries()) {
      for (const [v, voice] of bar.voices.entries()) {
        const i = voice.beats.findIndex((beat) => beat.id === beatId);
        if (i >= 0) return { track: t, bar: b, voice: v, beat: i };
      }
    }
  }
  throw new CommandError(command, 'not-found', `no beat ${beatId}`);
}

export function findBeats(score: Score, beatIds: readonly Id[], command: string): BeatAt[] {
  const wanted = new Set(beatIds);
  const found: BeatAt[] = [];
  if (wanted.size === 0) return found;
  baseOf(score).tracks.forEach((track, t) => {
    track.bars.forEach((bar, b) => {
      bar.voices.forEach((voice, v) => {
        voice.beats.forEach((beat, i) => {
          if (wanted.delete(beat.id)) found.push({ track: t, bar: b, voice: v, beat: i });
        });
      });
    });
  });
  const [missing] = wanted;
  if (missing !== undefined) throw new CommandError(command, 'not-found', `no beat ${missing}`);
  return found;
}

export function findVoice(score: Score, voiceId: Id, command: string): Omit<BeatAt, 'beat'> {
  const base = baseOf(score);
  for (const [t, track] of base.tracks.entries()) {
    for (const [b, bar] of track.bars.entries()) {
      const v = bar.voices.findIndex((voice) => voice.id === voiceId);
      if (v >= 0) return { track: t, bar: b, voice: v };
    }
  }
  throw new CommandError(command, 'not-found', `no voice ${voiceId}`);
}

export function findNotes(score: Score, noteIds: readonly Id[], command: string): NoteAt[] {
  const wanted = new Set(noteIds);
  const found: NoteAt[] = [];
  if (wanted.size === 0) return found;
  const base = baseOf(score);
  base.tracks.forEach((track, t) => {
    track.bars.forEach((bar, b) => {
      bar.voices.forEach((voice, v) => {
        voice.beats.forEach((beat, i) => {
          beat.notes.forEach((note, n) => {
            if (wanted.delete(note.id))
              found.push({ track: t, bar: b, voice: v, beat: i, note: n });
          });
        });
      });
    });
  });
  const [missing] = wanted;
  if (missing !== undefined) throw new CommandError(command, 'not-found', `no note ${missing}`);
  return found;
}

export function findMasterBar(score: Score, masterBarId: Id, command: string): number {
  const index = baseOf(score).masterBars.findIndex((masterBar) => masterBar.id === masterBarId);
  if (index < 0) throw new CommandError(command, 'not-found', `no master bar ${masterBarId}`);
  return index;
}

export function findTrack(score: Score, trackId: Id, command: string): number {
  const index = baseOf(score).tracks.findIndex((track) => track.id === trackId);
  if (index < 0) throw new CommandError(command, 'not-found', `no track ${trackId}`);
  return index;
}

/** Index access that the locators above have already proven in range. */
export function at<T>(items: readonly T[], index: number, command: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new CommandError(command, 'not-found', `index ${String(index)} is out of range`);
  }
  return item;
}

export function beatAt(score: Score, { track, bar, voice, beat }: BeatAt, command: string) {
  const voiceNode = at(
    at(at(score.tracks, track, command).bars, bar, command).voices,
    voice,
    command,
  );
  return at(voiceNode.beats, beat, command);
}

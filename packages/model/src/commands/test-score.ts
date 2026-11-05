import { expect } from 'vitest';

import type { Bar } from '../bar';
import type { Beat } from '../beat';
import {
  createBar,
  createBeat,
  createMasterBar,
  createNote,
  createScoreMeta,
  createTrack,
  createVoice,
} from '../factories';
import { createHistory } from '../history';
import type { Applied, Command } from '../history';
import { newId } from '../id';
import type { Note } from '../note';
import type { Score } from '../score';
import { validateScore } from '../validate';
import { CommandError } from './command-error';
import type { CommandErrorCode } from './command-error';

export function barOf(...beats: Beat[]): Bar {
  return {
    ...createBar(),
    voices: [createVoice(beats), createVoice(), createVoice(), createVoice()],
  };
}

export const quarter = (...notes: Note[]): Beat =>
  createBeat(notes.length > 0 ? { notes } : { rest: true });

/**
 * Four bars of 4/4 at 120 on a guitar and a drum track. Guitar bar 0 ends on string 1 fret 3,
 * tied into bar 1; the guitar carries one lyric line from bar 2.
 */
export function buildScore(): Score {
  const masterBars = [
    createMasterBar({ tempo: { bpm: 120 } }),
    createMasterBar(),
    createMasterBar(),
    createMasterBar(),
  ];
  const guitar = createTrack('fretted', {
    lyrics: [{ startBar: 2, text: 'la la' }],
    bars: [
      barOf(
        quarter(createNote({ string: 1, fret: 3 }), createNote({ string: 2, fret: 5 })),
        quarter(createNote({ string: 3, fret: 0 })),
        quarter(),
        quarter(createNote({ string: 1, fret: 3 })),
      ),
      barOf(
        quarter(createNote({ string: 1, fret: 3, tie: true })),
        quarter(createNote({ string: 6, fret: 22 })),
      ),
      barOf(quarter(createNote({ string: 2, fret: 7 }))),
      barOf(),
    ],
  });
  const drums = createTrack('drums', {
    bars: [barOf(quarter(createNote({ string: 0, fret: 36 }))), barOf(), barOf(), barOf()],
  });
  return {
    id: newId(),
    meta: createScoreMeta(),
    masterBars,
    tracks: [guitar, drums],
  };
}

export function beatOf(score: Score, track: number, bar: number, beat: number, voice = 0): Beat {
  const found = score.tracks[track]?.bars[bar]?.voices[voice]?.beats[beat];
  if (!found)
    throw new Error(`no beat at ${String(track)}/${String(bar)}/${String(voice)}/${String(beat)}`);
  return found;
}

export function noteOf(score: Score, track: number, bar: number, beat: number, note = 0): Note {
  const found = beatOf(score, track, bar, beat).notes[note];
  if (!found) throw new Error('no such note');
  return found;
}

/**
 * Applies, undoes and redoes `command`, asserting the undone score deep-equals `score`, the
 * redone one the applied one, and that the edit kept every invariant.
 */
export function roundTrip(score: Score, command: Command): Applied {
  const history = createHistory();
  const applied = history.apply(score, command);
  expect(applied.change.patches.length).toBeGreaterThan(0);
  expect(validateScore(applied.score)).toEqual([]);
  expect(history.undo()?.score).toEqual(score);
  expect(history.redo()?.score).toEqual(applied.score);
  return applied;
}

export function expectRefusal(score: Score, command: Command, code: CommandErrorCode): void {
  const history = createHistory();
  let error: unknown;
  try {
    history.apply(score, command);
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(CommandError);
  expect(error).toMatchObject({ code, command: command.name });
  expect(history.canUndo).toBe(false);
}

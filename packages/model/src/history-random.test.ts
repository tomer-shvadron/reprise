/**
 * A seeded walk over every command with undo and redo interleaved, checking that the history
 * lands exactly on each recorded state and that no accepted edit breaks an invariant.
 */
import { describe, expect, it } from 'vitest';

import { insertBar, removeBar, setMasterBar } from './commands/bar-commands';
import {
  insertBeat,
  removeBeat,
  setBeatDuration,
  setBeatEffect,
  setBeatRest,
} from './commands/beat-commands';
import { CommandError } from './commands/command-error';
import {
  removeNote,
  setNote,
  setNoteEffect,
  shiftStrings,
  transposeSelection,
} from './commands/note-commands';
import { buildScore } from './commands/test-score';
import { addTrack, moveTrack, removeTrack, setTrackProperties } from './commands/track-commands';
import { createNote } from './factories';
import { createHistory } from './history';
import type { Command } from './history';
import type { Score } from './score';
import { validateScore } from './validate';

/** mulberry32: a seeded generator so a failure replays. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Picker {
  int(max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

function picker(next: () => number): Picker {
  const int = (max: number): number => Math.floor(next() * max);
  return {
    int,
    pick(items) {
      const item = items[int(items.length)];
      if (item === undefined) throw new Error('picked from an empty list');
      return item;
    },
    chance: (p) => next() < p,
  };
}

interface Located {
  trackIndex: number;
  track: Score['tracks'][number];
  bar: number;
  voice: number;
  beat: Score['tracks'][number]['bars'][number]['voices'][number]['beats'][number];
}

function beats(score: Score): Located[] {
  const found: Located[] = [];
  score.tracks.forEach((track, trackIndex) => {
    track.bars.forEach((bar, b) => {
      bar.voices.forEach((voice, v) => {
        for (const beat of voice.beats) found.push({ trackIndex, track, bar: b, voice: v, beat });
      });
    });
  });
  return found;
}

function randomNote(r: Picker, track: Score['tracks'][number]) {
  if (track.kind === 'fretted') {
    return { string: 1 + r.int(track.tuning.length), fret: r.int(13) };
  }
  return { string: 0, fret: 36 + r.int(48) };
}

function randomCommand(r: Picker, score: Score): Command {
  const located = beats(score);
  const notes = located.flatMap((l) => l.beat.notes.map((note) => ({ ...l, note })));
  const kind = located.length === 0 ? 5 : r.int(17);
  switch (kind) {
    case 0: {
      const l = r.pick(located);
      return setNote({ beatId: l.beat.id }, { ...randomNote(r, l.track), tie: r.chance(0.2) });
    }
    case 1:
      if (notes.length === 0) return randomCommand(r, score);
      return removeNote({ noteId: r.pick(notes).note.id });
    case 2:
      if (notes.length === 0) return randomCommand(r, score);
      return setNoteEffect(
        { noteId: r.pick(notes).note.id },
        r.pick([
          { palmMute: true },
          { dynamics: 'pp' as const },
          { accidental: 'sharp' as const },
          { accidental: null },
          { tie: true },
          { tie: false },
          { trill: { fret: r.int(12), speed: 16 as const } },
        ]),
      );
    case 3:
      return transposeSelection(
        {
          beatIds: r.chance(0.5) ? [r.pick(located).beat.id] : [],
          noteIds: notes.length > 0 && r.chance(0.5) ? [r.pick(notes).note.id] : [],
        },
        r.int(7) - 3,
      );
    case 4:
      if (notes.length === 0) return randomCommand(r, score);
      return shiftStrings({ noteIds: [r.pick(notes).note.id] }, r.pick(['higher', 'lower']));
    case 5: {
      const track = r.pick(score.tracks);
      const bar = r.pick(track.bars);
      const voice = bar.voices[r.int(2)] ?? bar.voices[0];
      return insertBeat(
        { voiceId: voice.id, index: r.int(voice.beats.length + 1) },
        {
          duration: r.pick([4, 8, 16] as const),
          notes: r.chance(0.5) ? [createNote(randomNote(r, track))] : [],
        },
      );
    }
    case 6:
      return removeBeat({ beatId: r.pick(located).beat.id });
    case 7:
      return setBeatDuration(
        { beatId: r.pick(located).beat.id },
        r.pick([
          { duration: 8 as const },
          { duration: 4 as const, dots: 1 as const },
          { tuplet: { n: 3, of: 2 } },
          { tuplet: null },
          { duration: 2 as const },
        ]),
      );
    case 8:
      return setBeatRest({ beatId: r.pick(located).beat.id }, r.chance(0.5));
    case 9: {
      const l = r.pick(located);
      return setBeatEffect(
        { beatId: l.beat.id },
        r.pick([
          { effects: { pickStroke: 'down' as const } },
          { effects: { pickStroke: null } },
          { text: 'hey' },
          { text: null },
          { lyrics: ['la'] },
          {
            grace: [
              { duration: 16 as const, before: true, notes: [createNote(randomNote(r, l.track))] },
            ],
          },
          { grace: null },
        ]),
      );
    }
    case 10:
      return insertBar(
        { index: r.int(score.masterBars.length + 1) },
        r.chance(0.3) ? { tempo: { bpm: 60 + r.int(120) } } : {},
      );
    case 11:
      return removeBar({ masterBarId: r.pick(score.masterBars).id });
    case 12:
      return setMasterBar(
        { masterBarId: r.pick(score.masterBars).id },
        r.pick([
          {
            timeSignature: {
              numerator: r.pick([3, 4, 6, 7]),
              denominator: r.pick([4, 8] as const),
            },
          },
          { keySignature: { fifths: r.int(15) - 7, minor: r.chance(0.5) } },
          { tempo: { bpm: 60 + r.int(120) } },
          { tempo: null },
          { repeat: { start: r.chance(0.5), endCount: r.pick([0, 2, 3]) } },
          { alternateEndings: r.pick([[], [1], [2], [1, 2]]) },
          { section: { name: 'A' } },
          { section: null },
          { doubleBar: true },
        ]),
      );
    case 13:
      return setTrackProperties(
        { trackId: r.pick(score.tracks).id },
        r.pick([
          { name: 'x' },
          { capo: r.int(4) },
          { tuning: [38, 45, 50, 55, 59, 64] },
          { tuning: [40, 45, 50, 55, 59, 64] },
          { tuning: [40, 45, 50, 55] },
          { channel: { volume: r.int(128) } },
          { display: { notation: 'both' as const } },
          { lyrics: [{ startBar: r.int(score.masterBars.length), text: 'la' }] },
        ]),
      );
    case 14:
      return addTrack({
        kind: r.pick(['fretted', 'drums', 'pitched'] as const),
        index: r.int(score.tracks.length + 1),
      });
    case 15:
      return removeTrack({ trackId: r.pick(score.tracks).id });
    default:
      return moveTrack({ trackId: r.pick(score.tracks).id }, r.int(score.tracks.length));
  }
}

const STEPS = 300;

describe('history under random edits', () => {
  it.each([1, 2, 3, 4, 5])(
    'seed %i: undo and redo walk the exact states, and every edit keeps the invariants',
    (seed) => {
      const r = picker(random(seed));
      const history = createHistory();
      const original = buildScore();
      // states[i] is the score after i undoable steps; cursor is where the history stands.
      const states: Score[] = [original];
      let cursor = 0;
      let current = original;
      let applied = 0;
      let refused = 0;
      let groupDepth = 0;
      let groupChanged = false;
      const record = (): void => {
        states.length = cursor + 1;
        states.push(current);
        cursor += 1;
      };
      for (let step = 0; step < STEPS; step++) {
        const roll = r.int(10);
        if (groupDepth === 0 && roll === 0 && history.canUndo) {
          cursor -= 1;
          current = history.undo()?.score ?? current;
          expect(current).toStrictEqual(states[cursor]);
          continue;
        }
        if (groupDepth === 0 && roll === 1 && history.canRedo) {
          cursor += 1;
          current = history.redo()?.score ?? current;
          expect(current).toStrictEqual(states[cursor]);
          continue;
        }
        if (roll === 2 && groupDepth === 0) {
          history.beginGroup('group');
          groupDepth = 1;
        }
        const command = randomCommand(r, current);
        let next: Score;
        let changed: boolean;
        try {
          const result = history.apply(current, command);
          next = result.score;
          changed = result.change.patches.length > 0;
          applied += 1;
        } catch (error) {
          if (!(error instanceof CommandError)) throw error;
          refused += 1;
          continue;
        }
        expect(validateScore(next)).toEqual([]);
        if (!changed) expect(next).toStrictEqual(current);
        current = next;
        if (groupDepth > 0) {
          groupChanged ||= changed;
          if (r.chance(0.4)) {
            history.endGroup();
            groupDepth = 0;
            if (groupChanged) record();
            groupChanged = false;
          }
          continue;
        }
        if (changed) record();
      }
      if (groupDepth > 0) {
        history.endGroup();
        if (groupChanged) record();
      }
      while (history.canUndo) {
        cursor -= 1;
        expect(history.undo()?.score).toStrictEqual(states[cursor]);
      }
      expect(cursor).toBe(0);
      expect(history.undo()).toBeUndefined();
      while (history.canRedo) {
        cursor += 1;
        expect(history.redo()?.score).toStrictEqual(states[cursor]);
      }
      expect(applied).toBeGreaterThan(STEPS / 3);
      expect(refused).toBeGreaterThan(0);
    },
  );
});

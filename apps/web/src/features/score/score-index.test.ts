import {
  applyCommand,
  beatTicks,
  createBeat,
  createHistory,
  createNote,
  insertBar,
  insertBeat,
  moveTrack,
  newId,
  removeBar,
  removeBeat,
  replaceBeats,
  setBeatDurations,
  setNote,
  type Command,
  type Id,
  type Score,
} from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { scoreIndex, type BeatInfo } from './score-index';

/** The index written the plain way: one pass over the score, no derivation. */
function oracle(score: Score) {
  const beats = new Map<Id, BeatInfo>();
  const noteBeat = new Map<Id, Id>();
  const noteString = new Map<Id, number>();
  const barIndex = new Map(score.masterBars.map((bar, index) => [bar.id, index]));
  score.tracks.forEach((track, trackIndex) => {
    track.bars.forEach((bar, masterBarIndex) => {
      bar.voices.forEach((voice, voiceIndex) => {
        let tick = 0;
        voice.beats.forEach((beat, index) => {
          beats.set(beat.id, {
            masterBarIndex,
            trackIndex,
            voice: voiceIndex,
            index,
            tick,
            loneRest: beat.rest && voice.beats.length === 1,
          });
          for (const note of [...beat.notes, ...(beat.grace ?? []).flatMap((g) => g.notes)]) {
            noteBeat.set(note.id, beat.id);
            noteString.set(note.id, note.string);
          }
          tick += beatTicks(beat);
        });
      });
    });
  });
  return { barIndex, beats, noteBeat, noteString };
}

function sameTable<V>(actual: ReadonlyMap<Id, V>, expected: ReadonlyMap<Id, V>): void {
  expect(new Map(actual)).toEqual(expected);
  expect(actual.size).toBe(expected.size);
  for (const [id, value] of expected) {
    expect(actual.get(id)).toEqual(value);
    expect(actual.has(id)).toBe(true);
  }
}

function expectMatches(score: Score, gone: Iterable<Id> = []): void {
  const index = scoreIndex(score);
  const expected = oracle(score);
  sameTable(index.barIndex, expected.barIndex);
  sameTable(index.beats, expected.beats);
  sameTable(index.noteBeat, expected.noteBeat);
  sameTable(index.noteString, expected.noteString);
  for (const id of gone) {
    if (expected.beats.has(id) || expected.noteBeat.has(id)) continue;
    expect(index.beats.get(id)).toBeUndefined();
    expect(index.noteBeat.get(id)).toBeUndefined();
    expect(index.noteString.has(id)).toBe(false);
  }
}

const idsOf = (score: Score): Id[] => [
  ...oracle(score).beats.keys(),
  ...oracle(score).noteBeat.keys(),
];

/** A small deterministic generator, so a failure reproduces from its seed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function pickVoice(score: Score, next: () => number) {
  const track = score.tracks[Math.floor(next() * score.tracks.length)];
  const bar = track?.bars[Math.floor(next() * (track.bars.length || 1))];
  const voice = bar?.voices[0];
  if (!track || !bar || !voice) throw new Error('empty score');
  return { track, bar, voice };
}

function randomCommand(score: Score, next: () => number): Command {
  const { track, voice } = pickVoice(score, next);
  const beat = voice.beats[Math.floor(next() * (voice.beats.length || 1))];
  switch (Math.floor(next() * 9)) {
    case 0:
      return insertBeat(
        { voiceId: voice.id, index: voice.beats.length, id: newId() },
        { duration: 16, notes: [{ ...createNote({ string: 2, fret: 3 }), id: newId() }] },
      );
    case 1:
      return removeBeat({ beatId: beat?.id ?? '' });
    case 2:
      return setBeatDurations(
        voice.beats.slice(0, 2).map((target) => ({
          beatId: target.id,
          rhythm: { duration: 16, dots: 0, tuplet: null },
        })),
      );
    case 3:
      return setNote({ beatId: beat?.id ?? '' }, { string: 4, fret: Math.floor(next() * 12) });
    case 4:
      return insertBar({ index: Math.floor(next() * (score.masterBars.length + 1)) });
    case 5:
      return removeBar({
        masterBarId: score.masterBars[Math.floor(next() * score.masterBars.length)]?.id ?? '',
      });
    case 6:
      return moveTrack({ trackId: track.id }, Math.floor(next() * score.tracks.length));
    case 7:
      return replaceBeats([
        {
          voiceId: voice.id,
          index: 0,
          remove: Math.min(1, voice.beats.length),
          beats: [createBeat({ duration: 8, notes: [createNote({ string: 1, fret: 1 })] })],
        },
      ]);
    default:
      return removeBeat({ beatId: voice.beats.at(-1)?.id ?? '' });
  }
}

describe('scoreIndex, derived from the previous score', () => {
  it('matches a cold rebuild after each kind of edit', () => {
    let score = largeScore(3, 12, { structure: true });
    expectMatches(score);
    const track = score.tracks[0];
    const voice = track?.bars[2]?.voices[0];
    const first = voice?.beats[0];
    if (!track || !voice || !first) throw new Error('empty fixture');
    const old = scoreIndex(score);
    const oldIds = idsOf(score);
    const edits: Command[] = [
      removeBeat({ beatId: first.id }),
      insertBeat(
        { voiceId: voice.id, index: 0, id: newId() },
        { duration: 8, notes: [{ ...createNote({ string: 1, fret: 4 }), id: newId() }] },
      ),
      setBeatDurations([
        { beatId: voice.beats[1]?.id ?? '', rhythm: { duration: 16, dots: 0, tuplet: null } },
      ]),
      replaceBeats([
        { voiceId: voice.id, index: 1, remove: 2, beats: [createBeat({ duration: 4 })] },
        {
          voiceId: score.tracks[1]?.bars[5]?.voices[0]?.id ?? '',
          index: 0,
          remove: 1,
          beats: [createBeat({ duration: 8 })],
        },
      ]),
      insertBar({ index: 3 }),
      removeBar({ masterBarId: score.masterBars[7]?.id ?? '' }),
      moveTrack({ trackId: track.id }, 2),
    ];
    for (const edit of edits) {
      const before = score;
      score = applyCommand(score, edit).score;
      expectMatches(score, oldIds);
      expectMatches(before);
    }
    // The first index still answers for the first score after many newer ones.
    expect(old.beats.has(first.id)).toBe(true);
    expect(old.beats.get(first.id)?.index).toBe(0);
  });

  it('follows undo and redo, and an unrelated score between edits', () => {
    const history = createHistory();
    let score = largeScore(2, 10);
    const other = largeScore(1, 4);
    expectMatches(score);
    const voice = score.tracks[1]?.bars[4]?.voices[0];
    if (!voice) throw new Error('empty fixture');
    const gone = idsOf(score);
    score = history.apply(score, removeBeat({ beatId: voice.beats[0]?.id ?? '' })).score;
    expectMatches(other);
    expectMatches(score, gone);
    score = history.undo()?.score ?? score;
    expectMatches(score, gone);
    score = history.redo()?.score ?? score;
    expectMatches(score, gone);
  });

  it('stays correct across a sequence long enough to force a flatten', () => {
    let score = largeScore(4, 40);
    expectMatches(score);
    const gone = new Set(idsOf(score));
    // Each edit replaces a few beats with fresh ids, so the overlay grows past its limit.
    for (let round = 0; round < 120; round += 1) {
      const track = score.tracks[round % 4];
      const voice = track?.bars[round % 40]?.voices[0];
      if (!voice) throw new Error('empty fixture');
      score = applyCommand(
        score,
        replaceBeats([
          {
            voiceId: voice.id,
            index: 0,
            remove: voice.beats.length,
            beats: Array.from({ length: 8 }, () =>
              createBeat({ duration: 8, notes: [createNote({ string: 1, fret: round % 12 })] }),
            ),
          },
        ]),
      ).score;
      if (round % 20 === 19) expectMatches(score, gone);
    }
  });

  it('equals a cold rebuild after randomized edits, undo and redo', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const next = random(seed);
      const history = createHistory();
      let score = largeScore(3, 10, { structure: true });
      const seen = new Set(idsOf(score));
      let applied = 0;
      expectMatches(score);
      for (let step = 0; step < 40; step += 1) {
        const roll = next();
        if (roll < 0.15) score = history.undo()?.score ?? score;
        else if (roll < 0.25) score = history.redo()?.score ?? score;
        else {
          try {
            score = history.apply(score, randomCommand(score, next)).score;
            applied += 1;
          } catch {
            // A refused command leaves the score as it was.
          }
        }
        for (const id of idsOf(score)) seen.add(id);
        expectMatches(score, seen);
      }
      // Guards against a generator whose commands are all refused.
      expect(applied).toBeGreaterThan(8);
    }
  });
});

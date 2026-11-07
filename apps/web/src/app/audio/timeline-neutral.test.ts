import {
  addTrack,
  createHistory,
  moveTrack,
  setNote,
  setTrackProperties,
  type Command,
  type Score,
} from '@reprise/model';
import { beatOf, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { timelineNeutral } from './timeline-neutral';

const song = () =>
  score()
    .track('guitar')
    .bar()
    .beat('1', [note(1, 0)])
    .track('bass')
    .bar()
    .beat('1', [note(1, 0)])
    .build();

function edit(before: Score, command: (score: Score) => Command) {
  const history = createHistory();
  const { score: after } = history.apply(before, command(before));
  const undone = history.undo()?.score;
  if (!undone) throw new Error('no undo');
  return { after, undone };
}

const first = (s: Score) => ({ trackId: s.tracks[0]?.id ?? '' });

describe('timelineNeutral', () => {
  it.each([
    ['volume', { channel: { volume: 40 } }],
    ['pan', { channel: { pan: 0 } }],
    ['program', { program: 30 }],
    ['name', { name: 'Lead' }],
    ['colour', { color: '#123456' }],
    ['display', { display: { notation: 'both' as const } }],
  ])('is true for a %s change and its undo', (_, changes) => {
    const before = song();
    const { after, undone } = edit(before, (s) => setTrackProperties(first(s), changes));
    expect(after).not.toBe(before);
    expect(timelineNeutral(before, after)).toBe(true);
    expect(timelineNeutral(after, undone)).toBe(true);
  });

  it.each([
    ['tuning', { tuning: [40, 45, 50, 55, 59, 62] }],
    ['capo', { capo: 2 }],
    ['bank', { bank: 1 }],
    ['sound', { sound: { preset: 'Steel' } }],
  ])('is false for a %s change', (_, changes) => {
    const before = song();
    const { after } = edit(before, (s) => setTrackProperties(first(s), changes));
    expect(timelineNeutral(before, after)).toBe(false);
  });

  it('is false for note, track-list and master-bar edits', () => {
    const before = song();
    const cases: ((s: Score) => Command)[] = [
      (s) => setNote({ beatId: beatOf(s, 0, 0, 0).id }, { string: 1, fret: 3 }),
      () => addTrack({ kind: 'fretted' }),
      (s) => moveTrack({ trackId: s.tracks[0]?.id ?? '' }, 1),
    ];
    for (const command of cases) {
      expect(timelineNeutral(before, edit(before, command).after)).toBe(false);
    }
    const masterEdit = { ...before, masterBars: [...before.masterBars] };
    expect(timelineNeutral(before, masterEdit)).toBe(false);
  });
});

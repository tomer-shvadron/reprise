import { describe, expect, it } from 'vitest';

import { createHistory } from '../history';
import { newId } from '../id';
import type { MasterBar } from '../master-bar';
import type { Score } from '../score';
import { validateScore } from '../validate';
import { insertBar, removeBar, setMasterBar } from './bar-commands';
import { barOf, buildScore, expectRefusal, noteOf, roundTrip } from './test-score';

function withMasterBars(score: Score, edit: (masterBars: MasterBar[]) => MasterBar[]): Score {
  return { ...score, masterBars: edit(score.masterBars) };
}

function masterBar(score: Score, index: number): MasterBar {
  const found = score.masterBars[index];
  if (!found) throw new Error(`no master bar ${String(index)}`);
  return found;
}

// Bars 1 and 2 repeat with endings 1 and 2: |: 0 | 1 (1.) :| 2 (2.) | 3 |
function withVoltas(score: Score): Score {
  return withMasterBars(score, ([first, second, third, fourth]) => [
    { ...masterBar(score, 0), ...first, repeat: { start: true, endCount: 0 } },
    {
      ...masterBar(score, 1),
      ...second,
      alternateEndings: [1],
      repeat: { start: false, endCount: 2 },
    },
    { ...masterBar(score, 2), ...third, alternateEndings: [2] },
    { ...masterBar(score, 3), ...fourth },
  ]);
}

describe('insertBar', () => {
  it('inserts an empty bar in every track, copying the signatures before it', () => {
    const score = withMasterBars(buildScore(), (bars) =>
      bars.map((bar, m) =>
        m === 1 ? { ...bar, timeSignature: { numerator: 3, denominator: 4 } } : bar,
      ),
    );
    const id = newId();
    const { score: after, change } = roundTrip(score, insertBar({ index: 2, id }));
    expect(after.masterBars.map((bar) => bar.id)).toEqual([
      masterBar(score, 0).id,
      masterBar(score, 1).id,
      id,
      masterBar(score, 2).id,
      masterBar(score, 3).id,
    ]);
    expect(masterBar(after, 2).timeSignature).toEqual({ numerator: 3, denominator: 4 });
    for (const track of after.tracks) expect(track.bars).toHaveLength(5);
    expect(change.touchedBars).toEqual(
      expect.arrayContaining([id, masterBar(score, 2).id, masterBar(score, 3).id]),
    );
  });

  it('shifts lyric lines that start at or after it', () => {
    const score = buildScore();
    const { score: after } = roundTrip(score, insertBar({ index: 2 }));
    expect(after.tracks[0]?.lyrics).toEqual([{ startBar: 3, text: 'la la' }]);
  });

  it('moves the tempo onto a new first bar and releases ties across it', () => {
    const score = buildScore();
    const { score: atStart } = roundTrip(score, insertBar({ index: 0 }));
    expect(masterBar(atStart, 0).tempo).toEqual({ bpm: 120 });
    expect(masterBar(atStart, 1)).not.toHaveProperty('tempo');

    const { score: inside } = roundTrip(score, insertBar({ index: 1 }));
    expect(noteOf(inside, 0, 2, 0).tie).toBe(false);
  });

  it('keeps the old first bar its tempo when the new one brings its own', () => {
    const score = buildScore();
    const { score: after } = roundTrip(score, insertBar({ index: 0 }, { tempo: { bpm: 90 } }));
    expect([masterBar(after, 0).tempo, masterBar(after, 1).tempo]).toEqual([
      { bpm: 90 },
      { bpm: 120 },
    ]);
  });

  it('joins a volta both neighbours share', () => {
    const score = withMasterBars(buildScore(), (bars) =>
      bars.map((bar, m) =>
        m === 1 || m === 2
          ? { ...bar, alternateEndings: [1], repeat: { start: false, endCount: m === 2 ? 2 : 0 } }
          : bar,
      ),
    );
    const { score: after } = roundTrip(score, insertBar({ index: 2 }));
    expect(masterBar(after, 2).alternateEndings).toEqual([1]);
  });

  it('refuses a bad index, a used id and an invalid master bar', () => {
    const score = buildScore();
    expectRefusal(score, insertBar({ index: 5 }), 'invalid-value');
    expectRefusal(score, insertBar({ index: 0, id: score.id }), 'duplicate-id');
    expectRefusal(
      score,
      insertBar({ index: 1 }, { timeSignature: { numerator: 0, denominator: 4 } }),
      'invalid-value',
    );
  });
});

describe('removeBar', () => {
  it('removes a bar from every track and releases ties across the gap', () => {
    const score = buildScore();
    const { score: after, change } = roundTrip(
      score,
      removeBar({ masterBarId: masterBar(score, 0).id }),
    );
    expect(after.masterBars).toHaveLength(3);
    expect(noteOf(after, 0, 0, 0).tie).toBe(false);
    expect(change.touchedBars).toContain(masterBar(score, 0).id);
  });

  it('carries the first bar tempo onto the new first bar', () => {
    const score = buildScore();
    const { score: after } = roundTrip(score, removeBar({ masterBarId: masterBar(score, 0).id }));
    expect(masterBar(after, 0)).toMatchObject({ id: masterBar(score, 1).id, tempo: { bpm: 120 } });
  });

  it('carries a middle bar tempo onto the bar after it, and drops the last bar with its own', () => {
    const score = withMasterBars(buildScore(), (bars) =>
      bars.map((bar, m) => (m === 1 || m === 3 ? { ...bar, tempo: { bpm: 80 + m } } : bar)),
    );
    const { score: shorter } = roundTrip(score, removeBar({ masterBarId: masterBar(score, 1).id }));
    expect(shorter.masterBars.map((bar) => bar.tempo?.bpm)).toEqual([120, 81, 83]);
    const { score: trimmed } = roundTrip(score, removeBar({ masterBarId: masterBar(score, 3).id }));
    expect(trimmed.masterBars.map((bar) => bar.tempo?.bpm)).toEqual([120, 81, undefined]);
  });

  it('leaves a new first bar its own tempo', () => {
    const score = withMasterBars(buildScore(), (bars) =>
      bars.map((bar, m) => (m === 1 ? { ...bar, tempo: { bpm: 60 } } : bar)),
    );
    const { score: after } = roundTrip(score, removeBar({ masterBarId: masterBar(score, 0).id }));
    expect(masterBar(after, 0).tempo).toEqual({ bpm: 60 });
  });

  it('moves lyric lines back and keeps one starting on the removed bar in range', () => {
    const score = buildScore();
    expect(
      roundTrip(score, removeBar({ masterBarId: masterBar(score, 1).id })).score.tracks[0]?.lyrics,
    ).toEqual([{ startBar: 1, text: 'la la' }]);
    const trimmed = roundTrip(score, removeBar({ masterBarId: masterBar(score, 3).id })).score;
    expect(
      roundTrip(trimmed, removeBar({ masterBarId: masterBar(trimmed, 2).id })).score.tracks[0]
        ?.lyrics,
    ).toEqual([{ startBar: 1, text: 'la la' }]);
  });

  it('refuses the last bar and a removal that orphans a volta', () => {
    const score = buildScore();
    const single: Score = {
      ...score,
      masterBars: [masterBar(score, 0)],
      tracks: score.tracks.map((track) => ({ ...track, lyrics: [], bars: [barOf()] })),
    };
    expectRefusal(single, removeBar({ masterBarId: masterBar(score, 0).id }), 'last-bar');
    const voltas = withVoltas(score);
    expectRefusal(voltas, removeBar({ masterBarId: masterBar(voltas, 1).id }), 'invariant');
  });
});

describe('setMasterBar', () => {
  it('sets time, key, tempo, repeats, endings, jumps, targets, section and anacrusis', () => {
    const score = buildScore();
    const masterBarId = masterBar(score, 2).id;
    const { score: after } = roundTrip(
      score,
      setMasterBar(
        { masterBarId },
        {
          timeSignature: { numerator: 7, denominator: 8 },
          keySignature: { fifths: -3, minor: true },
          tempo: { bpm: 90, unit: 'dottedQuarter', label: 'Slower' },
          repeat: { start: true, endCount: 3 },
          alternateEndings: [1, 2],
          jumps: [{ kind: 'dsAlCoda' }],
          targets: ['segno', 'coda'],
          section: { name: 'Chorus', letter: 'B' },
          anacrusis: true,
          tripletFeel: 'eighth',
          doubleBar: true,
        },
      ),
    );
    expect(masterBar(after, 2)).toMatchObject({
      jumps: [{ kind: 'dsAlCoda' }],
      section: { name: 'Chorus' },
    });
  });

  it('clears an optional field with null and touches only its bar', () => {
    const score = withMasterBars(buildScore(), (bars) =>
      bars.map((bar, m) =>
        m === 3 ? { ...bar, section: { name: 'Outro' }, tempo: { bpm: 80 } } : bar,
      ),
    );
    const masterBarId = masterBar(score, 3).id;
    const { score: after, change } = roundTrip(
      score,
      setMasterBar({ masterBarId }, { section: null, tempo: null }),
    );
    expect(masterBar(after, 3)).not.toHaveProperty('section');
    expect(change.touchedBars).toEqual([masterBarId]);
  });

  it('refuses to remove the first tempo, an orphaned volta and a signature that overfills a bar', () => {
    const score = buildScore();
    expectRefusal(
      score,
      setMasterBar({ masterBarId: masterBar(score, 0).id }, { tempo: null }),
      'invariant',
    );
    expectRefusal(
      score,
      setMasterBar({ masterBarId: masterBar(score, 3).id }, { alternateEndings: [1] }),
      'invariant',
    );
    expectRefusal(
      score,
      setMasterBar(
        { masterBarId: masterBar(score, 0).id },
        { timeSignature: { numerator: 3, denominator: 4 } },
      ),
      'voice-overfull',
    );
    expectRefusal(
      score,
      setMasterBar({ masterBarId: masterBar(score, 0).id }, { alternateEndings: [9] }),
      'invalid-value',
    );
  });

  it('tolerates a violation the score already carried', () => {
    const score = withMasterBars(buildScore(), (bars) =>
      bars.map((bar, m) => (m === 3 ? { ...bar, alternateEndings: [1] } : bar)),
    );
    const history = createHistory();
    const { score: after } = history.apply(
      score,
      setMasterBar({ masterBarId: masterBar(score, 1).id }, { tempo: { bpm: 100 } }),
    );
    expect(validateScore(after).map((violation) => violation.rule)).toEqual([
      'alternate-ending-outside-repeat',
    ]);
    expect(history.undo()?.score).toEqual(score);
  });
});

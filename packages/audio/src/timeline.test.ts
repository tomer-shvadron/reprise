import { describe, expect, it } from 'vitest';

import { PPQ } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import {
  clicksInRange,
  countInTicks,
  createTimeline,
  loopRange,
  mixesInRange,
  notesInRange,
} from './timeline';

const BAR = PPQ * 4;

describe('notesInRange', () => {
  it('folds a tie across a bar line into its origin', () => {
    const tied = score()
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 5)])
      .bar()
      .beat('2', [note(1, 5, { tie: true })])
      .beat('2', [note(1, 7)])
      .build();
    const timeline = createTimeline(tied);
    const onsets = notesInRange(timeline, 0, 2 * BAR, { runStartTick: 0, limitTick: 2 * BAR });

    expect(onsets.map((o) => [o.tick, o.durationTicks, o.note.fret])).toEqual([
      [0, 2 * PPQ, 0],
      [2 * PPQ, 4 * PPQ, 5],
      [6 * PPQ, 2 * PPQ, 7],
    ]);
  });

  it('sounds a tied note when playback starts on it', () => {
    const tied = score()
      .track('guitar')
      .bar()
      .beat('2', [note(1, 5)])
      .beat('2', [note(1, 5, { tie: true })])
      .build();
    const timeline = createTimeline(tied);
    const onsets = notesInRange(timeline, 2 * PPQ, BAR, { runStartTick: 2 * PPQ, limitTick: BAR });

    expect(onsets.map((o) => [o.tick, o.durationTicks])).toEqual([[2 * PPQ, 2 * PPQ]]);
  });

  it('names the next note on the string after the tie chain, in playback order', () => {
    const song = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .beat('2', [note(1, 0), note(2, 9)])
      .beat('2', [note(1, 5)])
      .bar()
      .repeatEnd(2)
      .beat('2', [note(1, 5, { tie: true })])
      .beat('4', [note(2, 7)])
      .beat('4', [note(1, 8)])
      .bar()
      .beat('1', [note(1, 3)])
      .build();
    const timeline = createTimeline(song);
    const onsets = notesInRange(timeline, 0, 5 * BAR, { runStartTick: 0, limitTick: 5 * BAR });
    const at = (tick: number, string: number) =>
      onsets.find((o) => Math.abs(o.tick - tick) < 1e-6 && o.note.string === string);

    expect(at(0, 1)?.next).toMatchObject({ tick: 2 * PPQ, note: { fret: 5 } });
    // The fret-5 note is tied into bar 1; the beat after the chain has nothing on string 1.
    expect(at(2 * PPQ, 1)?.durationTicks).toBe(4 * PPQ);
    expect(at(2 * PPQ, 1)?.next).toBeUndefined();
    // Another string on the next beat, or a rest, is no target either.
    expect(at(0, 2)?.next).toBeUndefined();
    expect(at(6 * PPQ, 2)?.next).toBeUndefined();
    // Bar 1's last note: the repeat takes it back to bar 0 first, then on to bar 2.
    expect(at(7 * PPQ, 1)?.next).toMatchObject({ tick: 2 * BAR, note: { fret: 0 } });
    expect(at(2 * BAR + 7 * PPQ, 1)?.next).toMatchObject({ tick: 4 * BAR, note: { fret: 3 } });
    expect(at(4 * BAR, 1)?.next).toBeUndefined();

    expect(at(0, 1)).toMatchObject({ masterBarIndex: 0, passIndex: 0, barEndTick: BAR });
    expect(at(2 * BAR, 1)).toMatchObject({ masterBarIndex: 0, passIndex: 1, barEndTick: 3 * BAR });
  });

  it('skips rests and clips durations to the limit', () => {
    const bars = score()
      .track('guitar')
      .bar()
      .rest('2')
      .beat('2', [note(1, 3)])
      .build();
    const onsets = notesInRange(createTimeline(bars), 0, BAR, {
      runStartTick: 0,
      limitTick: 3 * PPQ,
    });

    expect(onsets.map((o) => [o.tick, o.durationTicks])).toEqual([[2 * PPQ, PPQ]]);
  });
});

/** A bass note on string 6 held under a melody on string 1, tied twice across the bar line. */
function heldUnderMelody() {
  return score()
    .track('guitar')
    .bar()
    .beat('4', [note(6, 5), note(1, 0)])
    .beat('4', [note(1, 3)])
    .rest('4')
    .beat('4', [note(1, 5)])
    .bar()
    .beat('4', [note(6, 5, { tie: true }), note(1, 7)])
    .beat('4', [note(1, 8)])
    .beat('4', [note(6, 5, { tie: true, vibrato: 'slight' })])
    .beat('4', [note(1, 0)])
    .build();
}

describe('tie chains', () => {
  const run = (from: number, limitTick = 2 * BAR) =>
    notesInRange(createTimeline(heldUnderMelody()), from, 2 * BAR, {
      runStartTick: from,
      limitTick,
    }).filter((onset) => onset.note.string === 6);

  it('holds a note under a melody for its whole chain, its links as continuations', () => {
    const [held, ...others] = run(0);

    expect(others).toEqual([]);
    expect(held).toMatchObject({ tick: 0, durationTicks: BAR + 3 * PPQ });
    expect(held?.continuations.map((c) => [c.tick, c.durationTicks, c.note.vibrato])).toEqual([
      [BAR, PPQ, 'none'],
      [BAR + 2 * PPQ, PPQ, 'slight'],
    ]);
    // The beat after the last link has nothing on string 6.
    expect(held?.next).toBeUndefined();
  });

  it('sounds a link whose origin played before the run started, with the rest of the chain', () => {
    const onsets = run(PPQ);

    expect(onsets.map((o) => [o.tick, o.durationTicks, o.continuations.length])).toEqual([
      [BAR, 3 * PPQ, 1],
    ]);
  });

  it('clips the chain and its continuations to the limit', () => {
    const [held] = run(0, BAR + 2.5 * PPQ);

    expect(held?.durationTicks).toBe(BAR + 2.5 * PPQ);
    expect(held?.continuations.map((c) => [c.tick, c.durationTicks])).toEqual([
      [BAR, PPQ],
      [BAR + 2 * PPQ, PPQ / 2],
    ]);
  });

  it('ends a hold where a repeat jumps back, and sounds a tie it jumps back to', () => {
    // b0 | |: b1 | b2 :| b3, the string-6 note tied from b0 into b1 and from b2 into b3.
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [note(6, 5)])
      .bar()
      .repeatStart()
      .beat('1', [note(6, 5, { tie: true })])
      .bar()
      .repeatEnd(2)
      .beat('1', [note(6, 7)])
      .bar()
      .beat('1', [note(6, 7, { tie: true })])
      .build();
    const timeline = createTimeline(song);
    const onsets = notesInRange(timeline, 0, 6 * BAR, { runStartTick: 0, limitTick: 6 * BAR });

    // Playback: b0 b1 b2 b1 b2 b3. b2 does not hold into b1; b1's second play has no origin before it.
    expect(onsets.map((o) => [o.tick / BAR, o.durationTicks / BAR, o.note.fret])).toEqual([
      [0, 2, 5],
      [2, 1, 7],
      [3, 1, 5],
      [4, 2, 7],
    ]);
  });
});

describe('mixesInRange', () => {
  it('reports a mixer change on a rest beat and on a tied continuation', () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [note(1, 5)])
      .beat('2', [note(1, 5, { tie: true })], { mix: { pan: { value: 0 } } })
      .bar()
      .rest('1', { mix: { volume: { value: 30 } } })
      .build();
    const mixes = mixesInRange(createTimeline(song), 0, 2 * BAR, {
      runStartTick: 0,
      limitTick: 2 * BAR,
    });

    expect(mixes.map((m) => [m.tick, m.beatIndex, m.mix])).toEqual([
      [2 * PPQ, 1, { pan: { value: 0 } }],
      [BAR, 0, { volume: { value: 30 } }],
    ]);
    expect(
      mixesInRange(createTimeline(song), 0, 2 * BAR, { runStartTick: 3 * PPQ, limitTick: BAR }),
    ).toEqual([]);
  });
});

describe('grace lead', () => {
  const graced = score()
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 2)], { grace: [{ duration: 16, before: true, notes: [note(1, 1)] }] })
    .rest('2')
    .bar()
    .beat('4', [note(1, 3)], { grace: [{ duration: 16, before: true, notes: [note(1, 2)] }] })
    .rest('2.')
    .build();
  const timeline = createTimeline(graced);
  const lead = PPQ / 4;
  const frets = (from: number, to: number, runStartTick = 0, limitTick = 2 * BAR) =>
    notesInRange(timeline, from, to, { runStartTick, limitTick }).map((o) => o.note.fret);

  it('makes a beat due early by the grace notes before it, once', () => {
    expect(frets(0, PPQ - lead - 1)).toEqual([0]);
    expect(frets(PPQ - lead - 1, PPQ - 1)).toEqual([2]);
    expect(frets(PPQ - 1, BAR - lead)).toEqual([]);
    expect(frets(BAR - lead, BAR)).toEqual([3]);
    expect(frets(BAR, 2 * BAR)).toEqual([]);
  });

  it('never before the run start, and never at or past the limit', () => {
    expect(frets(PPQ, BAR, PPQ)).toEqual([2, 3]);
    expect(frets(PPQ, BAR - lead, PPQ)).toEqual([2]);
    expect(frets(0, BAR, 0, PPQ)).toEqual([0]);
    expect(frets(0, BAR, 0, BAR)).toEqual([0, 2]);
  });
});

describe('clicks and count-in', () => {
  it('accents the downbeat of each 4/4 bar', () => {
    const plain = score().track('guitar').bar().rest('1').bar().rest('1').build();
    const clicks = clicksInRange(createTimeline(plain), 0, 2 * BAR);

    expect(clicks.map((c) => [c.tick / PPQ, c.accent])).toEqual([
      [0, true],
      [1, false],
      [2, false],
      [3, false],
      [4, true],
      [5, false],
      [6, false],
      [7, false],
    ]);
  });

  it('aligns an anacrusis to the end of its bar and shortens the count-in by it', () => {
    const pickup = score()
      .track('guitar')
      .bar()
      .anacrusis()
      .beat('4', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 2)])
      .build();
    const timeline = createTimeline(pickup);

    expect(clicksInRange(timeline, 0, PPQ)).toEqual([{ tick: 0, accent: false }]);
    expect(countInTicks(timeline, 0)).toEqual({ ticks: 3 * PPQ, unit: PPQ });
    expect(countInTicks(timeline, PPQ)).toEqual({ ticks: BAR, unit: PPQ });
  });

  it('counts eighths in 6/8', () => {
    const compound = score().timeSignature(6, 8).track('guitar').bar().rest('2.').build();

    expect(countInTicks(createTimeline(compound), 0)).toEqual({ ticks: 3 * PPQ, unit: PPQ / 2 });
  });
});

describe('loopRange', () => {
  it('picks the pass of a repeated bar nearest the playhead', () => {
    const repeated = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .rest('1')
      .bar()
      .repeatEnd(2)
      .rest('1')
      .bar()
      .rest('1')
      .build();
    const timeline = createTimeline(repeated);
    const [first, second] = repeated.masterBars;
    if (!first || !second) throw new Error('fixture');
    const range = { startBar: first.id, endBar: second.id };

    expect(loopRange(timeline, range, 0)).toEqual({ startTick: 0, endTick: 2 * BAR });
    expect(loopRange(timeline, range, 2.5 * BAR)).toEqual({ startTick: 2 * BAR, endTick: 4 * BAR });
    expect(() => loopRange(timeline, { startBar: second.id, endBar: first.id }, 0)).toThrow(
      RangeError,
    );
  });
});

describe('an over-full bar', () => {
  /** 4/4 at 120: bar 0 holds six quarters on string 1 (over-full by two), bar 1 four on string 2. */
  function overfull() {
    const builder = score().tempo(120).track('guitar').bar();
    for (let fret = 0; fret < 6; fret++) builder.beat('4', [note(1, fret)]);
    builder.bar();
    for (let fret = 0; fret < 4; fret++) builder.beat('4', [note(2, fret)]);
    return builder.build({ validate: false });
  }

  it('lasts its longest voice and plays every beat before the next bar', () => {
    const timeline = createTimeline(overfull());
    expect(timeline.endTick).toBe(9600);
    const onsets = notesInRange(timeline, 0, 9600, { runStartTick: 0, limitTick: 9600 });

    expect(onsets.map((o) => o.tick)).toEqual(Array.from({ length: 10 }, (_, i) => i * PPQ));
    expect(onsets.slice(0, 6).map((o) => o.barEndTick)).toEqual(Array(6).fill(5760));
  });

  it('reaches the overflow from a window that starts past the written bar line', () => {
    const onsets = notesInRange(createTimeline(overfull()), BAR, 6 * PPQ, {
      runStartTick: 0,
      limitTick: 9600,
    });

    expect(onsets.map((o) => [o.note.string, o.note.fret])).toEqual([
      [1, 4],
      [1, 5],
    ]);
  });

  it('plays every beat of a song whose only bar is over-full', () => {
    const builder = score().tempo(120).track('guitar').bar();
    for (let fret = 0; fret < 6; fret++) builder.beat('4', [note(1, fret)]);
    const timeline = createTimeline(builder.build({ validate: false }));

    expect(timeline.endTick).toBe(6 * PPQ);
    const onsets = notesInRange(timeline, 0, timeline.endTick, {
      runStartTick: 0,
      limitTick: timeline.endTick,
    });
    expect(onsets.map((o) => o.note.fret)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps clicking the time signature through the stretch, accenting only the bar start', () => {
    const clicks = clicksInRange(createTimeline(overfull()), 0, 9600);

    expect(clicks.map((c) => c.tick)).toEqual(Array.from({ length: 10 }, (_, i) => i * PPQ));
    expect(clicks.filter((c) => c.accent).map((c) => c.tick)).toEqual([0, 6 * PPQ]);
  });

  it('skips an overflow click the next downbeat would cut short', () => {
    const builder = score().tempo(120).track('guitar').bar();
    for (let fret = 0; fret < 4; fret++) builder.beat('4', [note(1, fret)]);
    builder
      .beat('32', [note(1, 4)])
      .bar()
      .beat('1', [note(2, 0)]);
    const clicks = clicksInRange(createTimeline(builder.build({ validate: false })), 0, 3960 + BAR);

    expect(clicks.map((c) => [c.tick, c.accent])).toEqual([
      [0, true],
      [960, false],
      [1920, false],
      [2880, false],
      [3960, true],
      [3960 + 960, false],
      [3960 + 1920, false],
      [3960 + 2880, false],
    ]);
  });
});

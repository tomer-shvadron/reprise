import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { timelineOf } from '@/state/timeline';
import { fourBars, positionEventAt } from '@/test/position';

import { clock, describePosition } from './position-format';

describe('describePosition', () => {
  it('reads bar, beat and song time', () => {
    const song = fourBars();
    const timeline = timelineOf(song);
    const text = describePosition(timeline, positionEventAt(song, 1920));
    expect(text.bar).toBe('1/4');
    expect(text.beat).toBe('3/4');
    expect(text.time).toMatch(/^0:01 \/ 0:0\d$/);
    expect(text.sentence).toMatch(/^Bar 1 of 4, beat 3 of 4, 0:01 of 0:0\d$/);
  });

  it('describes tick 0 with no event, and dashes with no song', () => {
    const song = fourBars();
    expect(describePosition(timelineOf(song), undefined)).toMatchObject({
      bar: '1/4',
      beat: '1/4',
    });
    expect(describePosition(undefined, undefined)).toEqual({
      bar: '–',
      beat: '–',
      time: '0:00 / 0:00',
      sentence: 'No song open',
    });
  });

  it('counts six in 6/8 and gives a pickup its true beat', () => {
    const sixEight = score().timeSignature(6, 8).track('guitar').bar();
    for (let i = 0; i < 6; i++) sixEight.beat('8', [note(1, 0)]);
    const six = sixEight.build();
    expect(describePosition(timelineOf(six), positionEventAt(six, 5 * 480)).beat).toBe('6/6');

    const pickup = score()
      .track('guitar')
      .bar()
      .anacrusis()
      .beat('4', [note(1, 0)])
      .bar()
      .beat('1', [note(1, 0)])
      .build();
    expect(describePosition(timelineOf(pickup), positionEventAt(pickup, 0)).beat).toBe('4/4');
  });

  it('stops the beat at the numerator through an over-full bar’s overflow', () => {
    const builder = score().track('guitar').bar();
    for (let fret = 0; fret < 6; fret++) builder.beat('4', [note(1, fret)]);
    builder.bar().beat('1', [note(2, 0)]);
    const overfull = builder.build({ validate: false });
    const timeline = timelineOf(overfull);
    const beats = [3, 4, 5].map((i) =>
      describePosition(timeline, positionEventAt(overfull, i * 960)),
    );
    expect(beats.map((text) => [text.bar, text.beat])).toEqual([
      ['1/2', '4/4'],
      ['1/2', '4/4'],
      ['1/2', '4/4'],
    ]);
  });

  it('shows the written bar on a repeat’s second pass', () => {
    const song = score()
      .track('guitar')
      .bar()
      .repeatStart()
      .beat('1', [note(1, 0)])
      .repeatEnd()
      .bar()
      .beat('1', [note(1, 0)])
      .build();
    const text = describePosition(timelineOf(song), positionEventAt(song, 3840));
    expect(text.bar).toBe('1/2');
  });

  it('says so while counting in', () => {
    const song = fourBars();
    const text = describePosition(timelineOf(song), positionEventAt(song, 0, true));
    expect(text.beat).toBe('Count-in');
    expect(text.sentence).toBe('Counting in before bar 1 of 4');
  });
});

describe('clock', () => {
  it('formats minutes and hours', () => {
    expect(clock(59)).toBe('0:59');
    expect(clock(61)).toBe('1:01');
    expect(clock(3601)).toBe('1:00:01');
  });
});

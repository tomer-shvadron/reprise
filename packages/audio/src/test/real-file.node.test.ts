import { describe, expect, it } from 'vitest';

import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import type { NoteEvent } from '../sink';
import { START } from './harness';
import { completeness, expectedAttacks } from './real-file';

/** The sink event for one note, at its written time (120 BPM, so a quarter is half a second). */
function eventOf(
  song: Score,
  track: number,
  beat: number,
  n = 0,
  overrides: Partial<NoteEvent> = {},
): NoteEvent {
  const owner = song.tracks[track];
  const voice = owner?.bars[0]?.voices[0];
  const written = voice?.beats[beat];
  const picked = written?.notes[n];
  if (!owner || !written || !picked) throw new Error('no such note');
  return {
    track: owner,
    trackIndex: track,
    voiceIndex: 0,
    beat: written,
    beatIndex: beat,
    note: picked,
    when: START + beat * 0.5,
    duration: 0.5,
    playbackTick: beat * 960,
    durationTicks: 960,
    sequenceIndex: 0,
    masterBarIndex: 0,
    passIndex: 0,
    barEnd: START + 2,
    nextOnString: undefined,
    continuations: [],
    ...overrides,
  };
}

const quarters = (): Score =>
  score()
    .tempo(120)
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 2)])
    .beat('4', [note(1, 2, { tie: true })])
    .beat('4', [note(2, 3)])
    .build();

const codes = (song: Score, events: NoteEvent[]): string[] =>
  completeness(song, events)
    .violations.map((violation) => violation.code)
    .sort();

describe('completeness', () => {
  it('accepts every untied note once, on time, with the tied one absent', () => {
    const song = quarters();
    expect(
      codes(
        song,
        [0, 1, 3].map((beat) => eventOf(song, 0, beat)),
      ),
    ).toEqual([]);
  });

  it('allows a tied note that arrives as an onset', () => {
    const song = quarters();
    expect(
      codes(
        song,
        [0, 1, 2, 3].map((beat) => eventOf(song, 0, beat)),
      ),
    ).toEqual([]);
  });

  it('reports a missing, a doubled and a mistimed note', () => {
    const song = quarters();
    const events = [
      eventOf(song, 0, 0),
      eventOf(song, 0, 0),
      eventOf(song, 0, 1, 0, { when: START + 0.51 }),
    ];
    expect(codes(song, events)).toEqual([
      'note-mistimed',
      'note-not-scheduled',
      'note-scheduled-twice',
    ]);
  });

  it('reports an event of a pass that holds no such note', () => {
    const song = quarters();
    const events = [0, 1, 3].map((beat) => eventOf(song, 0, beat));
    events.push(eventOf(song, 0, 3, 0, { sequenceIndex: 5 }));
    expect(codes(song, events)).toEqual(['note-unexpected']);
  });

  it('counts the beats past the end of an over-full bar apart', () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 1)])
      .beat('4', [note(1, 2)])
      .build({ validate: false });
    const result = completeness(song, [
      eventOf(song, 0, 0),
      eventOf(song, 0, 1, 0, { when: START + 1 }),
    ]);
    expect(result.violations.map((violation) => violation.code)).toEqual(['beyond-bar-end']);
    expect(result.beyond.size).toBe(1);
  });
});

describe('expectedAttacks', () => {
  it('leaves out hammer-on and legato-slide destinations', () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 2, { hammerPull: true })])
      .beat('4', [note(1, 4, { slide: ['legato'] })])
      .beat('4', [note(1, 7)])
      .build();
    const attacks = expectedAttacks(
      song,
      [0, 1, 2, 3].map((beat) => eventOf(song, 0, beat)),
      new Set(),
    );
    expect(attacks.map((attack) => attack.event.beatIndex)).toEqual([0, 2]);
  });

  it('merges attacks within 30 ms and skips muted tracks, or the unsoloed ones', () => {
    const build = (channel: { mute?: boolean; solo?: boolean }): Score => {
      const song = score()
        .tempo(120)
        .track('guitar')
        .bar()
        .beat('1', [note(1, 0)])
        .track('guitar')
        .bar()
        .beat('1', [note(2, 0)])
        .build();
      const second = song.tracks[1];
      if (second) Object.assign(second.channel, channel);
      return song;
    };
    const plain = build({});
    const close = [eventOf(plain, 0, 0), eventOf(plain, 1, 0, 0, { when: START + 0.02 })];
    expect(expectedAttacks(plain, close, new Set())).toHaveLength(1);
    const apart = [eventOf(plain, 0, 0), eventOf(plain, 1, 0, 0, { when: START + 0.04 })];
    expect(expectedAttacks(plain, apart, new Set())).toHaveLength(2);
    const muted = build({ mute: true });
    expect(
      expectedAttacks(
        muted,
        [eventOf(muted, 0, 0), eventOf(muted, 1, 0, 0, { when: START + 0.04 })],
        new Set(),
      ),
    ).toHaveLength(1);
    const soloed = build({ solo: true });
    const solo = expectedAttacks(
      soloed,
      [eventOf(soloed, 0, 0), eventOf(soloed, 1, 0, 0, { when: START + 0.04 })],
      new Set(),
    );
    expect(solo.map((attack) => attack.event.trackIndex)).toEqual([1]);
    expect(muted.tracks[1]?.channel.mute).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import type { NoteEvent } from '../sink';
import { START } from './harness';
import type { Strike } from './harness';
import { completeness, expectedAttacks, strikeTiming } from './real-file';

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

  it('expects every beat of an over-full bar, past its written end too', () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 1)])
      .beat('4', [note(1, 2)])
      .build({ validate: false });
    const first = [eventOf(song, 0, 0), eventOf(song, 0, 1, 0, { when: START + 1 })];
    expect(codes(song, first)).toEqual(['note-not-scheduled']);
    expect(codes(song, [...first, eventOf(song, 0, 2, 0, { when: START + 2 })])).toEqual([]);
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
    expect(expectedAttacks(plain, close)).toHaveLength(1);
    const apart = [eventOf(plain, 0, 0), eventOf(plain, 1, 0, 0, { when: START + 0.04 })];
    expect(expectedAttacks(plain, apart)).toHaveLength(2);
    const muted = build({ mute: true });
    expect(
      expectedAttacks(muted, [
        eventOf(muted, 0, 0),
        eventOf(muted, 1, 0, 0, { when: START + 0.04 }),
      ]),
    ).toHaveLength(1);
    const soloed = build({ solo: true });
    const solo = expectedAttacks(soloed, [
      eventOf(soloed, 0, 0),
      eventOf(soloed, 1, 0, 0, { when: START + 0.04 }),
    ]);
    expect(solo.map((attack) => attack.event.trackIndex)).toEqual([1]);
    expect(muted.tracks[1]?.channel.mute).toBe(true);
  });
});

describe('strikeTiming', () => {
  const strikeOf = (event: NoteEvent, offset = 0): Strike => ({
    track: event.track.id,
    key: 60,
    velocity: 100,
    when: event.when + offset,
    sounded: true,
    missedSample: false,
  });
  const timing = (song: Score, events: NoteEvent[], struck: Strike[][]): string[] =>
    strikeTiming(song, events, struck).map((violation) => violation.code);

  it('accepts every note struck on its beat, and a legato destination not struck', () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 2, { hammerPull: true })])
      .beat('4', [note(2, 3)])
      .build();
    const events = [0, 1, 2].map((beat) => eventOf(song, 0, beat));
    const [a, , c] = events;
    if (!a || !c) throw new Error('three events');
    expect(timing(song, events, [[strikeOf(a)], [], [strikeOf(c)]])).toEqual([]);
  });

  it('fails a note the sampler never struck, as when a track is dropped', () => {
    const song = quarters();
    const events = [0, 1, 3].map((beat) => eventOf(song, 0, beat));
    const [a, b] = events;
    if (!a || !b) throw new Error('three events');
    expect(timing(song, events, [[strikeOf(a)], [strikeOf(b)], []])).toEqual(['note-not-struck']);
  });

  it('fails a strike 50 ms after its note', () => {
    const song = quarters();
    const events = [0, 1, 3].map((beat) => eventOf(song, 0, beat));
    const struck = events.map((event, i) => [strikeOf(event, i === 1 ? 0.05 : 0)]);
    expect(timing(song, events, struck)).toEqual(['strike-late']);
  });

  it('lets a grace or a stroke move the strike within its beat, and no further', () => {
    const song = score()
      .tempo(120)
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], { effects: { brush: { direction: 'down', duration: 32 } } })
      .build({ validate: false });
    const [event] = [eventOf(song, 0, 0)];
    expect(timing(song, [event], [[strikeOf(event, 0.05)]])).toEqual([]);
    expect(timing(song, [event], [[strikeOf(event, 0.6)]])).toEqual(['strike-late']);
  });
});

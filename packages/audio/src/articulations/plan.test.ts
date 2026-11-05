import { describe, expect, it } from 'vitest';

import type { Beat, Note, Track } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';

import type { NoteEvent } from '../sink';
import { placeGraces } from './grace';
import { ARTICULATION } from './parameters';
import { planNote } from './plan';
import type { PlanInput } from './plan';
import { noteVelocity } from './velocity';

const song = score().track('guitar').bar().rest('1').track('drums').bar().rest('1').build();
const [guitar, drums] = song.tracks;
if (!guitar || !drums) throw new Error('two tracks');

/** A quarter note at 120 BPM: 960 ticks in half a second. */
function input(track: Track, n: Note, spec: Partial<PlanInput> = {}): PlanInput {
  return {
    track,
    note: n,
    effects: {},
    when: 1,
    length: 0.5,
    beatLength: 0.5,
    secondsPerTick: 0.5 / 960,
    barEnd: 3,
    next: undefined,
    ...spec,
  };
}

describe('noteVelocity', () => {
  it('stays within MIDI velocity at both ends of the ladder', () => {
    expect(noteVelocity(note(1, 0, { dynamics: 'fff', accent: 'heavy' }))).toBe(127);
    expect(noteVelocity(note(1, 0, { dynamics: 'ppp', ghost: true }), { hammer: true })).toBe(1);
  });
});

describe('planNote', () => {
  it('gives a drum hit velocity and retriggers but no pitch, filter or length articulation', () => {
    const hit = midi(38, {
      dynamics: 'ff',
      palmMute: true,
      staccato: true,
      vibrato: 'wide',
      bend: {
        kind: 'bend',
        points: [
          { position: 0, value: 0 },
          { position: 60, value: 4 },
        ],
      },
    });
    const plan = planNote(input(drums, hit, { effects: { tremoloPicking: 16 } }));

    expect(plan.pitch).toBeUndefined();
    expect(plan.filter).toBeUndefined();
    expect(plan.strikes).toHaveLength(4);
    expect(plan.strikes.map((strike) => strike.key)).toEqual([38, 38, 38, 38]);
    expect(plan.strikes.at(-1)?.end).toBeCloseTo(1.5, 9);
  });

  it('carries a legato slide only when there is a next note to carry into', () => {
    const sliding = note(1, 5, { slide: ['legato'] });
    expect(planNote(input(guitar, sliding)).legatoInto).toBeUndefined();
    const next = { note: note(1, 7), when: 1.5 };
    expect(planNote(input(guitar, sliding, { next })).legatoInto).toBe(1.5);
  });

  it('continues a carried voice at the distance from its key instead of striking', () => {
    const plan = planNote(input(guitar, note(1, 7, { hammerPull: true }), { continues: 69 }));

    expect(plan.continues).toBe(true);
    expect(plan.strikes[0]).toMatchObject({ key: 69, detune: 2 });
  });

  it('skips the attack of a hammer-on and plays it a step softer', () => {
    const [strike] = planNote(input(guitar, note(1, 7, { hammerPull: true }))).strikes;
    expect(strike?.offset).toBe(ARTICULATION.hammerOffset);
    expect(strike?.velocity).toBe(79);
  });
});

describe('placeGraces', () => {
  function event(beat: Beat, n: Note, track: Track): NoteEvent {
    return {
      track,
      trackIndex: 0,
      voiceIndex: 0,
      beat,
      beatIndex: 0,
      note: n,
      when: 2,
      duration: 0.5,
      playbackTick: 0,
      durationTicks: 960,
      sequenceIndex: 0,
      masterBarIndex: 0,
      passIndex: 0,
      barEnd: 4,
      nextOnString: undefined,
    };
  }

  it('plays a drum beat’s grace notes once, from its first note', () => {
    const kick = midi(36);
    const snare = midi(38);
    const flam = midi(38);
    const built = score()
      .track('drums')
      .bar()
      .beat('4', [kick, snare], { grace: [{ duration: 32, before: true, notes: [flam] }] })
      .rest('2.')
      .build();
    const beat = built.tracks[0]?.bars[0]?.voices[0].beats[0];
    const track = built.tracks[0];
    if (!beat || !track) throw new Error('one beat');
    const [first, second] = beat.notes;
    if (!first || !second) throw new Error('two notes');

    const fromFirst = placeGraces(event(beat, first, track), 0.5 / 960, 0);
    const fromSecond = placeGraces(event(beat, second, track), 0.5 / 960, 0);
    expect(fromFirst.graces).toHaveLength(1);
    expect(fromFirst.graces[0]?.when).toBeCloseTo(2 - 0.0625, 9);
    expect(fromSecond.graces).toHaveLength(0);
  });

  it('plays a grace note on its own string’s event and points it at the main note', () => {
    const grace = note(2, 5);
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 3), note(2, 7)], {
        grace: [{ duration: 16, before: false, notes: [grace] }],
      })
      .rest('2.')
      .build();
    const beat = built.tracks[0]?.bars[0]?.voices[0].beats[0];
    const track = built.tracks[0];
    if (!beat || !track) throw new Error('one beat');
    const [top, second] = beat.notes;
    if (!top || !second) throw new Error('two notes');

    expect(placeGraces(event(beat, top, track), 0.5 / 960, 0).graces).toHaveLength(0);
    const placed = placeGraces(event(beat, second, track), 0.5 / 960, 0);
    expect(placed.delay).toBeCloseTo(0.125, 9);
    expect(placed.graces[0]?.next).toEqual({ note: second, when: 2.125 });
  });

  it('drops grace notes that would start before playback did', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 3)], { grace: [{ duration: 16, before: true, notes: [note(1, 1)] }] })
      .rest('2.')
      .build();
    const beat = built.tracks[0]?.bars[0]?.voices[0].beats[0];
    const track = built.tracks[0];
    const main = beat?.notes[0];
    if (!beat || !track || !main) throw new Error('one note');

    expect(placeGraces(event(beat, main, track), 0.5 / 960, 1.95).graces).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';

import type { Beat, BeatEffects, BendPoint, Note, Track } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';

import type { NoteEvent } from '../sink';
import { placeGraces } from './grace';
import { ARTICULATION } from './parameters';
import { planNote } from './plan';
import type { PlanInput, PlanLink } from './plan';
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
    links: [],
    ...spec,
  };
}

/** A tied note on string 1 fret 5, the origin's string and fret. */
function link(
  spec: Parameters<typeof note>[2],
  when: number,
  length = 0.5,
  effects: BeatEffects = {},
): PlanLink {
  return { note: note(1, 5, { tie: true, ...spec }), effects, when, length };
}

const points = (...values: [number, number][]): BendPoint[] =>
  values.map(([position, value]) => ({ position, value }));
const up = { kind: 'bend' as const, points: points([0, 0], [60, 4]) };
const hold = { kind: 'hold' as const, points: points([0, 4], [60, 4]) };
const release = { kind: 'release' as const, points: points([0, 4], [60, 0]) };

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

  it('plays a shorter last stroke when the length is not a multiple of the stroke', () => {
    const plan = planNote(
      input(drums, midi(38), { length: 0.5 / 3, effects: { tremoloPicking: 32 } }),
    );

    const whens = plan.strikes.map((strike) => strike.when - 1);
    expect(whens).toHaveLength(3);
    for (const [index, when] of whens.entries()) expect(when).toBeCloseTo(index * 0.0625, 9);
    expect(plan.strikes.at(-1)?.end).toBeCloseTo(1 + 0.5 / 3, 9);
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

describe('planNote over a tie chain', () => {
  const origin = (spec: Parameters<typeof note>[2] = {}): Note => note(1, 5, spec);
  const pitch = (planned: ReturnType<typeof planNote>, time: number): number | undefined =>
    planned.pitch?.(time);

  it('spans a bend to the end of the chain, or to the origin’s beat when the next link bends', () => {
    const bare = planNote(
      input(guitar, origin({ bend: up }), { length: 2, links: [link({}, 1.5, 1.5)] }),
    );
    const held = planNote(
      input(guitar, origin({ bend: up }), { length: 2, links: [link({ bend: hold }, 1.5, 1.5)] }),
    );

    // Inside the origin's beat, the chain-long bend is an eighth of the way, the beat-long half.
    expect(pitch(bare, 1.25)).toBeCloseTo(0.25, 9);
    expect(pitch(bare, 3)).toBeCloseTo(2, 9);
    expect(pitch(held, 1.25)).toBeCloseTo(1, 9);
  });

  it('holds a bend through one link and releases it on the next', () => {
    const planned = planNote(
      input(guitar, origin({ bend: up }), {
        length: 1.5,
        links: [link({ bend: hold }, 1.5), link({ bend: release }, 2)],
      }),
    );

    expect(pitch(planned, 1.25)).toBeCloseTo(1, 9);
    expect(pitch(planned, 1.75)).toBeCloseTo(2, 9);
    expect(pitch(planned, 2.25)).toBeCloseTo(1, 9);
    expect(pitch(planned, 2.5)).toBeCloseTo(0, 9);
  });

  it('stops spreading a bend at the first link with its own vibrato', () => {
    const vibrating = planNote(
      input(guitar, origin({ bend: up }), {
        length: 1.5,
        links: [link({}, 1.5), link({ vibrato: 'wide' }, 2)],
      }),
    );
    const bare = planNote(
      input(guitar, origin({ bend: up }), { length: 1.5, links: [link({}, 1.5), link({}, 2)] }),
    );

    expect(pitch(vibrating, 1.5)).toBeCloseTo(1, 9);
    expect(pitch(vibrating, 2)).toBeCloseTo(2, 9);
    expect(pitch(bare, 1.75)).toBeCloseTo(1, 9);
  });

  it('completes a bend at the release when a staccato link or note cuts it short', () => {
    const tied = planNote(
      input(guitar, origin({ bend: up }), {
        length: 1,
        links: [link({ staccato: true }, 1.5)],
      }),
    );
    const untied = planNote(input(guitar, origin({ bend: up, staccato: true })));

    expect(tied.strikes[0]?.end).toBeCloseTo(1.75, 9);
    expect(pitch(tied, 1.375)).toBeCloseTo(1, 9);
    expect(pitch(tied, 1.75)).toBeCloseTo(2, 9);
    expect(untied.strikes[0]?.end).toBeCloseTo(1.25, 9);
    expect(pitch(untied, 1.25)).toBeCloseTo(2, 9);
  });

  it('starts a bend written on a link at that link', () => {
    const planned = planNote(
      input(guitar, origin(), { length: 1, links: [link({ bend: up }, 1.5)] }),
    );

    expect(pitch(planned, 1.25)).toBeCloseTo(0, 9);
    expect(pitch(planned, 1.75)).toBeCloseTo(1, 9);
    expect(pitch(planned, 2)).toBeCloseTo(2, 9);
  });

  it('holds the last bend value until the next bend starts', () => {
    const bent = { kind: 'bend' as const, points: points([0, 0], [30, 4], [60, 4]) };
    const planned = planNote(
      input(guitar, origin({ bend: bent }), { length: 1.5, links: [link({ bend: release }, 2)] }),
    );

    expect(pitch(planned, 1.75)).toBeCloseTo(2, 9);
    expect(pitch(planned, 2.25)).toBeCloseTo(1, 9);
  });

  it('plays a whammy on a link’s beat over that beat', () => {
    const dive = { kind: 'dive' as const, points: points([0, 0], [60, -4]) };
    const releaseUp = { kind: 'releaseUp' as const, points: points([0, -4], [60, 0]) };
    const planned = planNote(
      input(guitar, origin(), {
        effects: { whammy: dive },
        length: 1,
        links: [link({}, 1.5, 0.5, { whammy: releaseUp })],
      }),
    );

    expect(pitch(planned, 1.25)).toBeCloseTo(-1, 9);
    expect(pitch(planned, 1.5)).toBeCloseTo(-2, 9);
    expect(pitch(planned, 1.75)).toBeCloseTo(-1, 9);
    expect(pitch(planned, 2)).toBeCloseTo(0, 9);
  });

  it('starts vibrato at the link that writes it and carries it through bare links, phase unbroken', () => {
    const planned = planNote(
      input(guitar, origin(), {
        length: 1.5,
        links: [link({ vibrato: 'wide' }, 1.5), link({}, 2)],
      }),
    );

    expect(pitch(planned, 1.4)).toBeCloseTo(0, 9);
    expect(pitch(planned, 1.55)).toBeCloseTo(0.6, 9);
    expect(pitch(planned, 2.05)).toBeCloseTo(-0.6, 9);
    expect(pitch(planned, 2 - 1e-9)).toBeCloseTo(pitch(planned, 2) ?? Number.NaN, 6);
  });

  it('slides out at the end of the chain, from the origin or a link', () => {
    for (const planned of [
      planNote(input(guitar, origin(), { length: 1, links: [link({ slide: ['outDown'] }, 1.5)] })),
      planNote(
        input(guitar, origin({ slide: ['outDown'] }), { length: 1, links: [link({}, 1.5)] }),
      ),
    ]) {
      expect(pitch(planned, 1.9)).toBeCloseTo(0, 9);
      expect(pitch(planned, 1.96)).toBeCloseTo(-1.5, 9);
      expect(pitch(planned, 2)).toBeCloseTo(-3, 9);
    }
  });

  it('glides into the next note only from the last link of a chain', () => {
    const next = { note: note(1, 7), when: 2 };
    const plan = (originSlide: 'shift' | 'legato' | undefined, linkSlide?: 'shift' | 'legato') =>
      planNote(
        input(guitar, origin(originSlide ? { slide: [originSlide] } : {}), {
          length: 1,
          next,
          links: [link(linkSlide ? { slide: [linkSlide] } : {}, 1.5)],
        }),
      );

    expect(plan('shift').pitch).toBeUndefined();
    expect(plan('legato').legatoInto).toBeUndefined();
    expect(pitch(plan(undefined, 'shift'), 1.9375)).toBeCloseTo(1, 9);
    expect(plan(undefined, 'legato').legatoInto).toBe(2);
  });

  it('glides from a staccato last link before its release, as from an untied staccato note', () => {
    const next = { note: note(1, 7), when: 2 };
    const plan = (slide: 'shift' | 'legato') =>
      planNote(
        input(guitar, origin(), {
          length: 1,
          next,
          links: [link({ staccato: true, slide: [slide] }, 1.5)],
        }),
      );

    // Released at 1.75 s, half the link's beat: the glide takes the last 62.5 ms before it.
    expect(pitch(plan('shift'), 1.6875)).toBeCloseTo(0, 9);
    expect(pitch(plan('shift'), 1.71875)).toBeCloseTo(1, 9);
    expect(plan('legato').legatoInto).toBe(2);
  });

  it('ends the chain at a dead or staccato link, and a staccato origin at half its beat', () => {
    const dead = planNote(
      input(guitar, origin({ letRing: true }), { length: 1.5, links: [link({ dead: true }, 1.5)] }),
    );
    const staccatoLink = planNote(
      input(guitar, origin(), { length: 1.5, links: [link({ staccato: true }, 1.5)] }),
    );
    const staccatoOrigin = planNote(
      input(guitar, origin({ staccato: true }), { length: 1, links: [link({}, 1.5)] }),
    );

    expect(dead.strikes[0]?.end).toBeCloseTo(1.58, 9);
    expect(dead.letRingUntil).toBeUndefined();
    expect(dead.dead).toBe(false);
    expect(staccatoLink.strikes[0]?.end).toBeCloseTo(1.75, 9);
    expect(staccatoOrigin.strikes[0]?.end).toBeCloseTo(1.25, 9);
  });

  it('damps the level and the tone from a palm-muted link of an open string', () => {
    const links = [link({ palmMute: true }, 1.5)];
    const open = planNote(input(guitar, origin(), { length: 1, links }));
    const harmonic = planNote(
      input(guitar, origin({ harmonic: { kind: 'natural' } }), { length: 1, links }),
    );
    const muted = planNote(input(guitar, origin({ palmMute: true }), { length: 1, links }));

    const damped = [
      { at: 1.5, db: 0 },
      { at: 1.75, db: -18 },
    ];
    expect(open.filterChanges).toEqual([
      { at: 1.5, filter: { type: 'lowpass', frequency: ARTICULATION.palmMute.cutoff } },
    ]);
    expect(open.gain).toEqual(damped);
    expect(harmonic.filterChanges).toEqual([]);
    expect(harmonic.gain).toEqual(damped);
    expect(muted.filterChanges).toEqual([]);
    expect(muted.gain).toEqual([
      { at: 1, db: 0 },
      { at: 1.25, db: -18 },
    ]);
  });

  it('fades a link after a palm-muted one from the damped level', () => {
    const planned = planNote(
      input(guitar, origin(), {
        length: 1.5,
        links: [link({ palmMute: true }, 1.5), link({}, 2, 0.5, { fadeOut: true })],
      }),
    );
    const { decayTo } = ARTICULATION.palmMute;

    expect(planned.gain).toEqual([
      { at: 1.5, db: 0 },
      { at: 1.75, db: decayTo },
      { at: 2, db: decayTo },
      { at: 2, db: decayTo },
      { at: 2.5, db: ARTICULATION.fadeFloor + decayTo },
    ]);
  });

  it('fades a link in across its own beat', () => {
    const planned = planNote(
      input(guitar, origin(), { length: 1, links: [link({}, 1.5, 0.5, { fadeIn: true })] }),
    );

    expect(planned.gain).toEqual([
      { at: 1.5, db: 0 },
      { at: 1.5, db: ARTICULATION.fadeFloor },
      { at: 2, db: 0 },
    ]);
  });

  it('ignores a link’s attack properties, let ring, trill and tremolo', () => {
    const ignored = link(
      {
        harmonic: { kind: 'natural' },
        trill: { fret: 7, speed: 16 },
        letRing: true,
        slide: ['intoFromBelow'],
        accent: 'heavy',
      },
      1.5,
      0.5,
      { tremoloPicking: 16 },
    );
    const planned = planNote(input(guitar, origin(), { length: 1, links: [ignored] }));

    expect(planned.strikes).toHaveLength(1);
    expect(planned.strikes[0]).toMatchObject({ key: 69, velocity: 95, end: 2 });
    expect(planned.pitch).toBeUndefined();
    expect(planned.letRingUntil).toBeUndefined();
  });

  it('applies only a link’s fades on a drum track', () => {
    const planned = planNote(
      input(drums, midi(38), {
        length: 1,
        links: [
          {
            note: midi(38, { tie: true, dead: true }),
            effects: { fadeOut: true },
            when: 1.5,
            length: 0.5,
          },
        ],
      }),
    );

    expect(planned.strikes.at(-1)?.end).toBeCloseTo(2, 9);
    expect(planned.gain).toEqual([
      { at: 1.5, db: 0 },
      { at: 1.5, db: 0 },
      { at: 2, db: ARTICULATION.fadeFloor },
    ]);
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
      continuations: [],
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

  it('plays a grace on an empty string from the first note that is not tied', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 3)])
      .beat('4', [note(1, 3, { tie: true }), note(2, 7)], {
        grace: [{ duration: 16, before: true, notes: [note(3, 5)] }],
      })
      .rest('2')
      .build();
    const beat = built.tracks[0]?.bars[0]?.voices[0].beats[1];
    const track = built.tracks[0];
    if (!beat || !track) throw new Error('two beats');
    const [tied, second] = beat.notes;
    if (!tied || !second) throw new Error('two notes');

    expect(placeGraces(event(beat, tied, track), 0.5 / 960, 0).graces).toHaveLength(0);
    expect(placeGraces(event(beat, second, track), 0.5 / 960, 0).graces).toHaveLength(1);
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

import { describe, expect, it } from 'vitest';

import type { Dynamics, Note } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';

import { RegionMap } from '../sampler/region-map';
import { SynthSampleSource, midiToFrequency } from '../sampler/sample-source';
import {
  SAMPLE_RATE,
  cents,
  peak,
  region,
  rms,
  toneLevel,
  zeroCrossingFrequency,
} from '../sampler/test/offline';
import { velocityGain } from '../sampler/voice';
import { harmonicInterval } from './harmonics';
import { ARTICULATION, DYNAMICS_VELOCITY } from './parameters';
import {
  T0,
  energyAbove,
  noiseInstrument,
  onsets,
  pitchTrack,
  pluckedInstrument,
  render,
} from './test/render';

const A4 = 440;
const B4 = midiToFrequency(71);
const E4 = midiToFrequency(64);

/** String 1 of a guitar in E standard: fret 5 is A4, fret 7 is B4. */
const a = (spec: Parameters<typeof note>[2] = {}): Note => note(1, 5, spec);
const b = (spec: Parameters<typeof note>[2] = {}): Note => note(1, 7, spec);

function pitchAt(data: Float32Array, from: number, to: number, expected: number): number {
  return cents(zeroCrossingFrequency(data, from, to), expected);
}

describe('dynamics and accents', () => {
  it('orders the levels by the dynamics ladder', async () => {
    const marks: Dynamics[] = ['ppp', 'p', 'mf', 'ff', 'fff'];
    let builder = score().track('guitar').bar();
    for (const mark of marks.slice(0, 4)) builder = builder.beat('4', [a({ dynamics: mark })]);
    builder = builder.bar().beat('4', [a({ dynamics: 'fff' })]);
    const { data } = await render(builder.build(), { seconds: 3 });

    const levels = marks.map((_, index) =>
      rms(data, T0 + index * 0.5 + 0.1, T0 + index * 0.5 + 0.4),
    );
    for (const [index, level] of levels.entries()) {
      const mark = marks[index] ?? 'f';
      const expected = velocityGain(DYNAMICS_VELOCITY[mark]) / velocityGain(DYNAMICS_VELOCITY.fff);
      expect(level / (levels.at(-1) ?? 1)).toBeCloseTo(expected, 2);
      if (index > 0) expect(level).toBeGreaterThan(levels[index - 1] ?? 0);
    }
  });

  it('puts ghost notes under, and accents over, the written dynamics', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a({ dynamics: 'mf', ghost: true })])
      .beat('4', [a({ dynamics: 'mf' })])
      .beat('4', [a({ dynamics: 'mf', accent: 'accent' })])
      .beat('4', [a({ dynamics: 'mf', accent: 'heavy' })])
      .build();
    const { data } = await render(song);

    const levels = [0, 1, 2, 3].map((k) => rms(data, T0 + k * 0.5 + 0.1, T0 + k * 0.5 + 0.4));
    expect(levels).toEqual([...levels].sort((x, y) => x - y));
    expect((levels[0] ?? 0) / (levels[1] ?? 1)).toBeCloseTo(velocityGain(47) / velocityGain(79), 2);
    expect((levels[3] ?? 0) / (levels[1] ?? 1)).toBeCloseTo(
      velocityGain(111) / velocityGain(79),
      2,
    );
  });

  it('applies dynamics on a drum track', async () => {
    const song = score()
      .track('drums')
      .bar()
      .beat('4', [midi(69, { dynamics: 'pp' })])
      .beat('4', [midi(69, { dynamics: 'ff' })])
      .rest('2')
      .build();
    const { data } = await render(song);

    const soft = rms(data, T0 + 0.1, T0 + 0.4);
    const loud = rms(data, T0 + 0.6, T0 + 0.9);
    expect(soft / loud).toBeCloseTo(velocityGain(31) / velocityGain(111), 2);
  });
});

describe('bends and whammy', () => {
  it('ends a full bend two semitones up within one cent', async () => {
    const bend = {
      kind: 'bend' as const,
      points: [
        { position: 0, value: 0 },
        { position: 15, value: 4 },
        { position: 60, value: 4 },
      ],
    };
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [a({ bend })])
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.01, T0 + 0.05, A4))).toBeLessThan(25);
    expect(Math.abs(pitchAt(data, T0 + 0.35, T0 + 0.95, A4 * 2 ** (2 / 12)))).toBeLessThan(1);
  });

  it('starts a prebend up and comes back down on the release', async () => {
    const bend = {
      kind: 'prebendRelease' as const,
      points: [
        { position: 0, value: 4 },
        { position: 20, value: 4 },
        { position: 40, value: 0 },
        { position: 60, value: 0 },
      ],
    };
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [a({ bend })])
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.01, T0 + 0.3, A4 * 2 ** (2 / 12)))).toBeLessThan(1);
    expect(Math.abs(pitchAt(data, T0 + 0.7, T0 + 0.95, A4))).toBeLessThan(1);
  });

  it('dives with the whammy bar across the beat', async () => {
    const whammy = {
      kind: 'dive' as const,
      points: [
        { position: 0, value: 0 },
        { position: 30, value: -8 },
        { position: 60, value: -8 },
      ],
    };
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [a()], { effects: { whammy } })
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.55, T0 + 0.95, A4 / 2 ** (4 / 12)))).toBeLessThan(1);
  });
});

describe('palm mute and dead notes', () => {
  it('leaves less energy above 2 kHz than the same note unmuted', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a({ palmMute: true })])
      .rest('4')
      .beat('4', [a()])
      .rest('4')
      .build();
    const { data } = await render(song, { instrument: noiseInstrument });

    const muted = energyAbove(data, 2000, T0 + 0.02, T0 + 0.2);
    const open = energyAbove(data, 2000, T0 + 1.02, T0 + 1.2);
    expect(muted).toBeLessThan(open * 0.25);
    // The shortened envelope: the muted note has decayed by the end of its beat; the open one has not.
    expect(rms(data, T0 + 0.4, T0 + 0.48) / rms(data, T0 + 0.02, T0 + 0.1)).toBeLessThan(0.2);
    expect(rms(data, T0 + 1.4, T0 + 1.48) / rms(data, T0 + 1.02, T0 + 1.1)).toBeGreaterThan(0.9);
  });

  it('plays a dead note as a short unpitched burst', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [a({ dead: true })])
      .rest('2')
      .build();
    const { data } = await render(song);

    const burst = rms(data, T0, T0 + 0.04);
    expect(burst).toBeGreaterThan(0.003);
    expect(toneLevel(data, A4, T0, T0 + 0.04)).toBeLessThan(burst * 0.2);
    expect(peak(data, T0 + ARTICULATION.dead.length + 0.02, T0 + 1)).toBeLessThan(1e-4);
  });
});

describe('ties, staccato and hammer-ons', () => {
  it('makes no second onset for a tie', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a()])
      .beat('4', [a({ tie: true })])
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(onsets(data)).toHaveLength(1);
    expect(rms(data, T0 + 0.6, T0 + 0.9)).toBeGreaterThan(0.1);
    expect(peak(data, T0 + 1.1, T0 + 1.5)).toBeLessThan(1e-4);
  });

  it('halves a staccato note', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a({ staccato: true })])
      .rest('4')
      .beat('4', [a()])
      .rest('4')
      .build();
    const { data } = await render(song);

    // Released at 0.25 s; the 50 ms release is over by 0.32 s.
    expect(peak(data, T0 + 0.32, T0 + 0.45)).toBeLessThan(1e-3);
    expect(peak(data, T0 + 1.32, T0 + 1.45)).toBeGreaterThan(0.1);
  });

  it('plays a hammer-on as a quieter second onset', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a()])
      .beat('4', [b({ hammerPull: true })])
      .rest('2')
      .build();
    const { data } = await render(song);

    const first = toneLevel(data, A4, T0 + 0.1, T0 + 0.45);
    const second = toneLevel(data, B4, T0 + 0.6, T0 + 0.95);
    expect(second / first).toBeCloseTo(velocityGain(79) / velocityGain(95), 2);
  });

  it('damps a re-plucked string within the choke fade, not the region release', async () => {
    const longRelease = { attack: 0.005, hold: 0, decay: 0, sustain: 1, release: 1 };
    const song = score().track('guitar').bar().beat('4', [a()]).beat('4', [b()]).rest('2').build();
    const instrument = () => ({
      regions: new RegionMap([region({ envelope: longRelease })]),
      source: new SynthSampleSource(SAMPLE_RATE, {
        a440: { kind: 'sine', frequency: 440, duration: 6 },
      }),
    });
    const { data } = await render(song, { instrument });

    expect(toneLevel(data, A4, T0 + 0.55, T0 + 0.9)).toBeLessThan(1e-3);
  });
});

describe('slides', () => {
  it('glides a shift slide into the next pitch, which is struck again', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [a({ slide: ['shift'] })])
      .beat('2', [b()])
      .build();
    const { data } = await render(song, { instrument: () => pluckedInstrument(3) });

    const target = 1200 * Math.log2(B4 / A4);
    expect(Math.abs(pitchAt(data, T0 + 0.3, T0 + 0.75, A4))).toBeLessThan(1);
    const glide = pitchTrack(data, A4, T0 + 0.8, T0 + 1)
      .filter(([time]) => time > T0 + 0.81 && time < T0 + 0.99)
      .map(([, value]) => value);
    expect(glide.at(-1)).toBeGreaterThan(target - 20);
    for (const [index, value] of glide.entries()) {
      if (index > 0) expect(value).toBeGreaterThan((glide[index - 1] ?? 0) - 2);
    }
    expect(Math.abs(pitchAt(data, T0 + 1.05, T0 + 1.4, B4))).toBeLessThan(1);
    // Struck again: the level jumps back up at the second note.
    expect(rms(data, T0 + 1.01, T0 + 1.05) / rms(data, T0 + 0.95, T0 + 0.99)).toBeGreaterThan(1.3);
  });

  it('carries a legato slide into the next note without a new attack', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [a({ slide: ['legato'] })])
      .beat('2', [b()])
      .build();
    const { data } = await render(song, { instrument: () => pluckedInstrument(3) });

    expect(Math.abs(pitchAt(data, T0 + 1.05, T0 + 1.4, B4))).toBeLessThan(1);
    expect(rms(data, T0 + 1.01, T0 + 1.05) / rms(data, T0 + 0.95, T0 + 0.99)).toBeLessThan(1.05);
    expect(onsets(data)).toHaveLength(1);
  });

  it('slides into a note from below and out of one downwards', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [a({ slide: ['intoFromBelow', 'outDown'] })])
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(pitchAt(data, T0 + 0.005, T0 + 0.03, A4)).toBeLessThan(-100);
    expect(Math.abs(pitchAt(data, T0 + 0.2, T0 + 0.8, A4))).toBeLessThan(1);
    expect(pitchAt(data, T0 + 0.96, T0 + 0.995, A4)).toBeLessThan(-100);
  });
});

describe('vibrato', () => {
  for (const kind of ['slight', 'wide'] as const) {
    it(`modulates the pitch periodically at the ${kind} vibrato's rate and depth`, async () => {
      const song = score()
        .track('guitar')
        .bar()
        .beat('1', [a({ vibrato: kind })])
        .build();
      const { data } = await render(song);

      const track = pitchTrack(data, A4, T0 + 0.05, T0 + 1.95);
      const values = track.map(([, value]) => value);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      // Rising crossings of the mean pitch, one per vibrato cycle.
      const rising: number[] = [];
      for (const [index, [time, value]] of track.entries()) {
        const before = track[index - 1]?.[1];
        if (before !== undefined && before < mean && value >= mean) rising.push(time);
      }
      const cycles = rising.length - 1;
      const measured = cycles / ((rising.at(-1) ?? 0) - (rising[0] ?? 0));
      const { rate, depth } = ARTICULATION.vibrato[kind];
      expect(Math.abs(measured - rate)).toBeLessThan(0.05);
      expect(Math.max(...values)).toBeCloseTo(depth * 100, -1);
      expect(Math.min(...values)).toBeCloseTo(-depth * 100, -1);
    });
  }
});

describe('trill and tremolo picking', () => {
  it('alternates a trill at its speed', async () => {
    const trill = { fret: 7, speed: 32 as const };
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a({ trill })])
      .rest('2.')
      .build();
    const { data } = await render(song, { instrument: pluckedInstrument });

    const found = onsets(data);
    expect(found).toHaveLength(8);
    for (const [index, onset] of found.entries()) {
      expect(Math.abs(onset - (T0 + index * 0.0625))).toBeLessThan(0.002);
      const expected = index % 2 === 0 ? A4 : B4;
      expect(Math.abs(pitchAt(data, onset + 0.001, onset + 0.015, expected))).toBeLessThan(5);
    }
  });

  it('retriggers tremolo picking at the stroke rate', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [a()], { effects: { tremoloPicking: 16 } })
      .rest('2')
      .build();
    const { data } = await render(song, { instrument: pluckedInstrument });

    const found = onsets(data);
    expect(found).toHaveLength(8);
    for (const [index, onset] of found.entries()) {
      expect(Math.abs(onset - (T0 + index * 0.125))).toBeLessThan(0.002);
    }
  });
});

describe('harmonics', () => {
  it('sounds a natural harmonic at its node: the octave at 12, the twelfth at 7, two octaves at 5', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 12, { harmonic: { kind: 'natural' } })])
      .beat('4', [note(1, 7, { harmonic: { kind: 'natural' } })])
      .beat('4', [note(1, 5, { harmonic: { kind: 'natural' } })])
      .rest('4')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.05, T0 + 0.45, E4 * 2))).toBeLessThan(1);
    expect(Math.abs(pitchAt(data, T0 + 0.55, T0 + 0.95, E4 * 3))).toBeLessThan(1);
    expect(Math.abs(pitchAt(data, T0 + 1.05, T0 + 1.45, E4 * 4))).toBeLessThan(1);
  });

  it('raises an artificial harmonic by its stated interval', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('2', [a({ harmonic: { kind: 'artificial', value: 12 } })])
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.05, T0 + 0.9, A4 * 2))).toBeLessThan(1);
  });

  it('maps the frets of the common nodes to their overtones', () => {
    const table: [number, number][] = [
      [12, 12],
      [7, 19.02],
      [19, 19.02],
      [5, 24],
      [24, 24],
      [4, 27.86],
      [9, 27.86],
      [16, 27.86],
      [3, 31.02],
      [3.2, 31.02],
      [2.7, 33.69],
    ];
    for (const [fret, interval] of table) expect(harmonicInterval(fret)).toBeCloseTo(interval, 2);
    expect(harmonicInterval(11)).toBeUndefined();
  });
});

describe('grace notes', () => {
  it('plays a grace note before the beat and the main note on it', async () => {
    const grace = [{ duration: 16 as const, before: true, notes: [a()] }];
    const song = score()
      .track('guitar')
      .bar()
      .rest('4')
      .beat('4', [b({ hammerPull: true })], { grace })
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.39, T0 + 0.49, A4))).toBeLessThan(1);
    expect(Math.abs(pitchAt(data, T0 + 0.52, T0 + 0.9, B4))).toBeLessThan(1);
    expect(peak(data, T0 + 0.2, T0 + 0.37)).toBeLessThan(1e-4);
  });

  it('plays an on-beat grace note on the beat and delays the main note by it', async () => {
    const grace = [{ duration: 16 as const, before: false, notes: [a()] }];
    const song = score()
      .track('guitar')
      .bar()
      .rest('4')
      .beat('4', [b()], { grace })
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(peak(data, T0 + 0.2, T0 + 0.49)).toBeLessThan(1e-4);
    expect(Math.abs(pitchAt(data, T0 + 0.51, T0 + 0.61, A4))).toBeLessThan(1);
    expect(Math.abs(pitchAt(data, T0 + 0.65, T0 + 0.95, B4))).toBeLessThan(1);
  });
});

describe('fades', () => {
  it('fades a note in across its beat', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [a()], { effects: { fadeIn: true } })
      .build();
    const { data } = await render(song);

    expect(rms(data, T0 + 0.01, T0 + 0.2) / rms(data, T0 + 1.8, T0 + 1.98)).toBeLessThan(0.05);
  });

  it('swells up and back down', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [a()], { effects: { volumeSwell: true } })
      .build();
    const { data } = await render(song);

    const middle = rms(data, T0 + 0.9, T0 + 1.1);
    expect(rms(data, T0 + 0.01, T0 + 0.1) / middle).toBeLessThan(0.05);
    expect(rms(data, T0 + 1.88, T0 + 1.98) / middle).toBeLessThan(0.05);
  });
});

describe('beat mixer changes', () => {
  it('lands a volume change on its beat, for every track when it says so', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [note(2, 5)])
      .track('guitar')
      .bar()
      .rest('2')
      .beat('4', [note(1, 17, { dynamics: 'ppp' })], {
        mix: { volume: { value: 50, allTracks: true } },
      })
      .rest('4')
      .build();
    const { data } = await render(song);

    const before = toneLevel(data, E4, T0 + 0.7, T0 + 0.98);
    const after = toneLevel(data, E4, T0 + 1.05, T0 + 1.45);
    expect(after / before).toBeCloseTo(velocityGain(50) / velocityGain(100), 2);

    const middle = (before + after) / 2;
    let crossing = 0;
    for (let time = T0 + 0.8; time < T0 + 1.3; time += 0.001) {
      if (toneLevel(data, E4, time - 0.015, time + 0.015) < middle) {
        crossing = time;
        break;
      }
    }
    expect(Math.abs(crossing - (T0 + 1))).toBeLessThan(0.01);
  });

  it('glides a volume change over its transition', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('1', [note(2, 5)], { mix: { volume: { value: 50, duration: 2 } } })
      .build();
    const { data } = await render(song);

    const start = toneLevel(data, E4, T0 + 0.01, T0 + 0.03);
    const middle = toneLevel(data, E4, T0 + 0.49, T0 + 0.51);
    const end = toneLevel(data, E4, T0 + 1.2, T0 + 1.5);
    // The first window is centred 20 ms into the 1 s glide: the fader is already that far down.
    const glided = 1 - 0.02 * (1 - velocityGain(50) / velocityGain(100));
    expect(start / end).toBeCloseTo((velocityGain(100) / velocityGain(50)) * glided, 1);
    expect(middle).toBeCloseTo((start + end) / 2, 2);
  });
});

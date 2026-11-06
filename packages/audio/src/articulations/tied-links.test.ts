import { describe, expect, it } from 'vitest';

import type { BendPoint, Note } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import { midiToFrequency } from '../sampler/sample-source';
import { cents, peak, rms, zeroCrossingFrequency } from '../sampler/test/offline';
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
const semitones = (count: number): number => A4 * 2 ** (count / 12);

/** String 1 of a guitar in E standard: fret 5 is A4, fret 7 is B4. */
const a = (spec: Parameters<typeof note>[2] = {}): Note => note(1, 5, spec);
const b = (spec: Parameters<typeof note>[2] = {}): Note => note(1, 7, spec);
const tied = (spec: Parameters<typeof note>[2] = {}): Note => a({ tie: true, ...spec });

const points = (...values: [number, number][]): BendPoint[] =>
  values.map(([position, value]) => ({ position, value }));
const fullBend = { kind: 'bend' as const, points: points([0, 0], [15, 4], [60, 4]) };

function pitchAt(data: Float32Array, from: number, to: number, expected: number): number {
  return cents(zeroCrossingFrequency(data, from, to), expected);
}

function pitches(data: Float32Array, from: number, to: number): number[] {
  return pitchTrack(data, A4, from, to).map(([, value]) => value);
}

describe('bends on tied links', () => {
  it('holds a bend through a tied link', async () => {
    const hold = { kind: 'hold' as const, points: points([0, 4], [60, 4]) };
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a({ bend: fullBend })])
      .beat('4', [tied({ bend: hold })])
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.55, T0 + 0.95, semitones(2)))).toBeLessThan(1);
  });

  it('releases a bend across the tied link that writes the release', async () => {
    const release = { kind: 'release' as const, points: points([0, 4], [60, 0]) };
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a({ bend: fullBend })])
      .beat('2', [tied({ bend: release })])
      .rest('4')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.3, T0 + 0.48, semitones(2)))).toBeLessThan(1);
    expect(Math.abs(pitchAt(data, T0 + 0.97, T0 + 1.03, semitones(1)))).toBeLessThan(3);
  });

  it('dives with a whammy written on a tied link’s beat', async () => {
    const dive = { kind: 'dive' as const, points: points([0, 0], [60, -4]) };
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a()])
      .beat('4', [tied()], { effects: { whammy: dive } })
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.73, T0 + 0.77, semitones(-1)))).toBeLessThan(3);
  });
});

describe('slides on tied links', () => {
  it('slides out from the last link at the end of the chain', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a()])
      .beat('4', [tied({ slide: ['outDown'] })])
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(Math.abs(pitchAt(data, T0 + 0.3, T0 + 0.9, A4))).toBeLessThan(1);
    expect(pitchAt(data, T0 + 0.96, T0 + 0.995, A4)).toBeLessThan(-100);
  });

  it('glides into the next note from the last link, not from the origin', async () => {
    const fromOrigin = score()
      .track('guitar')
      .bar()
      .beat('4', [a({ slide: ['shift'] })])
      .beat('4', [tied()])
      .beat('2', [b()])
      .build();
    const fromLink = score()
      .track('guitar')
      .bar()
      .beat('4', [a()])
      .beat('4', [tied({ slide: ['shift'] })])
      .beat('2', [b()])
      .build();
    const instrument = (): ReturnType<typeof pluckedInstrument> => pluckedInstrument(3);
    const origin = await render(fromOrigin, { instrument });
    const link = await render(fromLink, { instrument });

    expect(Math.abs(pitchAt(origin.data, T0 + 0.85, T0 + 0.99, A4))).toBeLessThan(1);
    const target = 1200 * Math.log2(B4 / A4);
    const glide = pitchTrack(link.data, A4, T0 + 0.85, T0 + 1).filter(
      ([time]) => time > T0 + 0.88 && time < T0 + 0.999,
    );
    expect(glide.at(-1)?.[1]).toBeGreaterThan(target - 20);
    expect(glide[0]?.[1]).toBeLessThan(target / 2);
  });
});

describe('vibrato on tied links', () => {
  it('starts vibrato at the onset of the link that writes it', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a()])
      .beat('2.', [tied({ vibrato: 'wide' })])
      .build();
    const { data } = await render(song);

    expect(Math.max(...pitches(data, T0 + 0.05, T0 + 0.45).map(Math.abs))).toBeLessThan(1);
    expect(Math.max(...pitches(data, T0 + 0.5, T0 + 0.6))).toBeGreaterThan(40);
    const held = pitches(data, T0 + 0.6, T0 + 1.9);
    expect(Math.max(...held)).toBeCloseTo(60, -1);
    expect(Math.min(...held)).toBeCloseTo(-60, -1);
  });

  it('keeps a link’s vibrato at its own time when an on-beat grace delays the origin', async () => {
    const grace = [{ duration: 16 as const, before: false, notes: [a()] }];
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a()], { grace })
      .beat('2.', [tied({ vibrato: 'wide' })])
      .build();
    const { data } = await render(song);

    expect(Math.max(...pitches(data, T0 + 0.2, T0 + 0.45).map(Math.abs))).toBeLessThan(1);
    expect(Math.max(...pitches(data, T0 + 0.5, T0 + 0.6))).toBeGreaterThan(40);
  });
});

describe('muted and faded links', () => {
  it('ends the chain shortly after a dead link, with no burst', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a()])
      .beat('4', [tied({ dead: true })])
      .rest('2')
      .build();
    const { data } = await render(song);

    expect(rms(data, T0 + 0.2, T0 + 0.45)).toBeGreaterThan(0.1);
    expect(peak(data, T0 + 0.7, T0 + 1)).toBeLessThan(1e-3);
    expect(onsets(data)).toHaveLength(1);
  });

  it('damps the highs from a palm-muted link on', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a()])
      .beat('4', [tied({ palmMute: true })])
      .rest('2')
      .build();
    const { data } = await render(song, { instrument: noiseInstrument });

    const open = energyAbove(data, 2000, T0 + 0.2, T0 + 0.45);
    const muted = energyAbove(data, 2000, T0 + 0.8, T0 + 0.95);
    expect(muted / open).toBeLessThan(0.05);
  });

  it('damps the highs from a palm-muted link when a legato slide carried the origin in', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 3, { slide: ['legato'] })])
      .beat('4', [a()])
      .beat('4', [tied({ palmMute: true })])
      .rest('4')
      .build();
    const { data } = await render(song, { instrument: noiseInstrument });

    const open = energyAbove(data, 2000, T0 + 0.7, T0 + 0.95);
    const muted = energyAbove(data, 2000, T0 + 1.3, T0 + 1.45);
    expect(muted / open).toBeLessThan(0.05);
  });

  it('fades a tied link in across its own beat', async () => {
    const song = score()
      .track('guitar')
      .bar()
      .beat('4', [a()])
      .beat('2.', [tied()], { effects: { fadeIn: true } })
      .build();
    const { data } = await render(song);

    const origin = rms(data, T0 + 0.2, T0 + 0.45);
    expect(rms(data, T0 + 0.51, T0 + 0.7) / origin).toBeLessThan(0.05);
    expect(rms(data, T0 + 1.8, T0 + 1.98) / origin).toBeGreaterThan(0.5);
  });
});

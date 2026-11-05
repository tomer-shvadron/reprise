import { describe, expect, it } from 'vitest';

import {
  STANDARD_TUNING,
  createBar,
  createBeat,
  createEmptyScore,
  createMasterBar,
  createNote,
  createTrack,
} from './factories';
import { ScoreSchema } from './score';
import { TrackSchema } from './track';
import { validateScore } from './validate';

describe('createEmptyScore', () => {
  it('is one fretted track in standard tuning, 4/4 at 120 BPM, with one empty bar', () => {
    const score = createEmptyScore();
    expect(score.masterBars).toHaveLength(1);
    expect(score.masterBars[0]).toMatchObject({
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { fifths: 0, minor: false },
      tempo: { bpm: 120 },
      repeat: { start: false, endCount: 0 },
      alternateEndings: [],
      jumps: [],
      targets: [],
      tripletFeel: 'none',
      doubleBar: false,
      anacrusis: false,
    });
    expect(score.tracks).toHaveLength(1);
    const track = score.tracks[0];
    expect(track?.kind).toBe('fretted');
    expect(track?.tuning).toEqual([40, 45, 50, 55, 59, 64]);
    expect(track?.bars).toHaveLength(1);
    expect(track?.bars[0]?.voices).toHaveLength(4);
    expect(track?.bars[0]?.voices.every((voice) => voice.beats.length === 0)).toBe(true);
  });

  it('validates against the schema and the invariants', () => {
    const score = createEmptyScore();
    expect(ScoreSchema.parse(score)).toEqual(score);
    expect(validateScore(score)).toEqual([]);
  });

  it('gives every node a fresh id', () => {
    const a = createEmptyScore();
    const b = createEmptyScore();
    expect(a.id).not.toBe(b.id);
    expect(a.tracks[0]?.id).not.toBe(b.tracks[0]?.id);
  });
});

describe('createTrack', () => {
  it('defaults a fretted track to six strings, 24 frets, tab notation', () => {
    const track = createTrack('fretted');
    expect(track).toMatchObject({
      kind: 'fretted',
      tuning: [...STANDARD_TUNING],
      capo: 0,
      fretCount: 24,
      program: 25,
      display: { notation: 'tab', clef: 'treble', octaveShift: 1 },
      channel: { volume: 100, pan: 64, mute: false, solo: false },
      lyrics: [],
    });
    expect(track.bars).toHaveLength(1);
    expect(TrackSchema.safeParse(track).success).toBe(true);
  });

  it('defaults drums to the GM kit on a percussion staff with no tuning', () => {
    const track = createTrack('drums');
    expect(track).toMatchObject({
      kind: 'drums',
      tuning: [],
      fretCount: 0,
      program: 0,
      bank: 0,
      display: { notation: 'standard', clef: 'percussion', octaveShift: 0 },
    });
    expect(TrackSchema.safeParse(track).success).toBe(true);
  });

  it('defaults pitched tracks to a treble staff with no tuning', () => {
    const track = createTrack('pitched');
    expect(track).toMatchObject({
      kind: 'pitched',
      tuning: [],
      fretCount: 0,
      display: { notation: 'standard', clef: 'treble', octaveShift: 0 },
    });
    expect(TrackSchema.safeParse(track).success).toBe(true);
  });

  it('takes overrides and a bar count', () => {
    const track = createTrack('fretted', {
      name: 'Bass',
      tuning: [28, 33, 38, 43],
      display: { notation: 'both', clef: 'bass', octaveShift: 1 },
      barCount: 3,
    });
    expect(track.name).toBe('Bass');
    expect(track.tuning).toEqual([28, 33, 38, 43]);
    expect(track.bars).toHaveLength(3);
    expect(new Set(track.bars.map((bar) => bar.id)).size).toBe(3);
    expect(track).not.toHaveProperty('barCount');
  });

  it('does not share the tuning array between tracks', () => {
    const a = createTrack('fretted');
    a.tuning[0] = 38;
    expect(createTrack('fretted').tuning[0]).toBe(40);
  });
});

describe('node factories', () => {
  it('createMasterBar defaults to 4/4 in C with no repeat', () => {
    const masterBar = createMasterBar({ timeSignature: { numerator: 3, denominator: 4 } });
    expect(masterBar.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(masterBar).not.toHaveProperty('tempo');
    expect(masterBar.repeat).toEqual({ start: false, endCount: 0 });
  });

  it('createBar has four empty voices', () => {
    const bar = createBar();
    expect(bar.voices.map((voice) => voice.beats)).toEqual([[], [], [], []]);
    expect(bar).not.toHaveProperty('clef');
  });

  it('createBeat is an empty quarter with no effects', () => {
    expect(createBeat()).toMatchObject({
      duration: 4,
      dots: 0,
      rest: false,
      notes: [],
      effects: {},
    });
  });

  it('createNote is a plain note at forte', () => {
    const note = createNote({ string: 3, fret: 5 });
    expect(note).toMatchObject({
      string: 3,
      fret: 5,
      tie: false,
      accent: 'none',
      vibrato: 'none',
      dynamics: 'f',
    });
    expect(note).not.toHaveProperty('bend');
  });
});

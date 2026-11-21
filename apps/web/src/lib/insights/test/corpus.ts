import type { Score } from '@reprise/model';
import { midi, score as buildScore } from '@reprise/model/testing';
import type { DurationSpec } from '@reprise/model/testing';

import type { KeyQuality } from '../key-names';
import type { ScaleId } from '../scales';

/** What the engine should answer for a piece. `none` is a riff with no third. */
export interface Expected {
  tonic: number;
  quality: KeyQuality | 'none';
  /** The scale the fit should name, when the piece is about one. */
  scale?: ScaleId;
}

export type Group =
  'scale' | 'cadence' | 'progression' | 'vamp' | 'solo' | 'power chord' | 'ornamented';

export interface Piece {
  name: string;
  group: Group;
  expected: Expected;
  score: Score;
}

/** One bar: what the chord track strikes on every beat (bass first) and what the melody plays in eighths. */
export interface BarSpec {
  chord: readonly number[];
  melody?: readonly number[];
}

/** The pitch of a degree of `scale` above `tonic`, in octave 4 and above (60 is middle C). */
const at = (tonic: number, semitones: number, octave = 4): number =>
  12 * (octave + 1) + tonic + semitones;

export function fromBars(bars: readonly BarSpec[]) {
  const builder = buildScore().track('piano', { name: 'Chords' });
  for (const bar of bars) {
    builder.bar();
    for (let beat = 0; beat < 4; beat++)
      builder.beat(
        '4',
        bar.chord.map((pitch) => midi(pitch)),
      );
  }
  builder.track('piano', { name: 'Melody' });
  for (const bar of bars) {
    builder.bar();
    const melody = bar.melody ?? [];
    for (let slot = 0; slot < 8; slot++) {
      const pitch = melody[slot];
      if (pitch === undefined) builder.rest('8');
      else builder.beat('8', [midi(pitch)]);
    }
  }
  return builder.build();
}

/** A melody as notes with durations, split into bars by the time signature. */
export function fromMelody(
  notes: readonly (readonly [number, DurationSpec])[],
  meter: readonly [number, 2 | 4 | 8] = [4, 4],
  bass: readonly (readonly [number, DurationSpec])[] = [],
) {
  const builder = buildScore().timeSignature(meter[0], meter[1]);
  const barLength = (meter[0] * 16) / meter[1]; // in sixteenths
  const sixteenths = (spec: DurationSpec): number => {
    const base = 64 / Number.parseInt(spec, 10);
    if (spec.endsWith('..')) return base * 1.75;
    if (spec.endsWith('.')) return base * 1.5;
    return base;
  };
  const lay = (name: string, line: readonly (readonly [number, DurationSpec])[]): void => {
    builder.track('piano', { name });
    let filled = barLength;
    for (const [pitch, duration] of line) {
      if (filled >= barLength) {
        builder.bar();
        filled = 0;
      }
      // A negative pitch is a rest, which lets a part wait for its entry.
      if (pitch < 0) builder.rest(duration);
      else builder.beat(duration, [midi(pitch)]);
      filled += sixteenths(duration);
    }
  };
  lay('Melody', notes);
  if (bass.length > 0) lay('Bass', bass);
  return builder.build();
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const triad = (tonic: number, offset: number, third: 3 | 4, octave = 4): number[] => [
  at(tonic, offset, octave - 2),
  at(tonic, offset, octave),
  at(tonic, offset + third, octave),
  at(tonic, offset + 7, octave),
];
const seventh = (tonic: number, offset: number, octave = 4): number[] => [
  at(tonic, offset, octave - 2),
  at(tonic, offset, octave),
  at(tonic, offset + 4, octave),
  at(tonic, offset + 7, octave),
  at(tonic, offset + 10, octave),
];
const run = (tonic: number, steps: readonly number[], octave = 5): number[] =>
  steps.map((step) => at(tonic, step, octave));

const UP_DOWN = [0, 1, 2, 3, 4, 5, 6, 7];

/** `degrees` indexes into a 7-note scale; 7 is the octave. */
const scaleMelody = (tonic: number, scale: readonly number[], degrees: readonly number[]) =>
  degrees.map((degree) => at(tonic, (scale[degree % 7] ?? 0) + 12 * Math.floor(degree / 7), 5));

function scaleRun(tonic: number, minor: boolean): Piece {
  const scale = minor ? MINOR : MAJOR;
  const third = minor ? 3 : 4;
  const chords = [
    triad(tonic, 0, third),
    triad(tonic, 5, minor ? 3 : 4),
    triad(tonic, 7, minor ? 3 : 4),
    triad(tonic, 0, third),
  ];
  const melody = [
    scaleMelody(tonic, scale, UP_DOWN),
    scaleMelody(tonic, scale, [...UP_DOWN].reverse()),
    scaleMelody(tonic, scale, [0, 2, 4, 2, 0, 2, 4, 2]),
    scaleMelody(tonic, scale, [0, 4, 2, 0]),
  ];
  return {
    name: `${minor ? 'minor' : 'major'} scale run, ${String(tonic)}`,
    group: 'scale',
    expected: { tonic, quality: minor ? 'minor' : 'major' },
    score: fromBars(chords.map((chord, i) => ({ chord, melody: melody[i] ?? [] }))),
  };
}

function cadence(tonic: number, minor: boolean): Piece {
  const third = minor ? 3 : 4;
  // The V of a minor key is major: the harmonic minor cadence.
  const chords = [
    triad(tonic, 0, third),
    triad(tonic, 5, minor ? 3 : 4),
    seventh(tonic, 7),
    triad(tonic, 0, third),
  ];
  return {
    name: `${minor ? 'harmonic minor' : 'major'} cadence, ${String(tonic)}`,
    group: 'cadence',
    expected: { tonic, quality: minor ? 'minor' : 'major' },
    score: fromBars(chords.map((chord) => ({ chord }))),
  };
}

function progression(
  name: string,
  tonic: number,
  minor: boolean,
  roots: readonly (readonly [number, 3 | 4])[],
): Piece {
  // Songs end on the tonic, which is the cue a loop alone cannot give.
  const first = roots[0] ?? [0, 4];
  const bars = [...roots, ...roots, first].map(([offset, third]) => ({
    chord: triad(tonic, offset, third),
  }));
  return {
    name: `${name}, ${String(tonic)}`,
    group: 'progression',
    expected: { tonic, quality: minor ? 'minor' : 'major' },
    score: fromBars(bars),
  };
}

function blues(tonic: number): Piece {
  const riff = (steps: readonly number[]) => run(tonic, steps);
  const form = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7];
  const bars = form.map((offset) => ({
    chord: seventh(tonic, offset),
    melody: riff([0, 3, 5, 6, 7, 10, 7, 5]),
  }));
  return {
    name: `12-bar blues, ${String(tonic)}`,
    group: 'progression',
    expected: { tonic, quality: 'major' },
    score: fromBars(bars),
  };
}

function vamp(
  name: string,
  tonic: number,
  quality: KeyQuality,
  scale: ScaleId,
  roots: readonly (readonly [number, 3 | 4])[],
): Piece {
  const first = roots[0] ?? [0, 4];
  const bars = [...roots, ...roots, ...roots, ...roots, first].map(([offset, third]) => ({
    chord: triad(tonic, offset, third),
  }));
  return {
    name: `${name}, ${String(tonic)}`,
    group: 'vamp',
    expected: { tonic, quality, scale },
    score: fromBars(bars),
  };
}

function solo(tonic: number, minor: boolean): Piece {
  const steps = minor ? [0, 3, 5, 7, 10, 12, 10, 7] : [0, 2, 4, 7, 9, 12, 9, 7];
  const down = [...steps].reverse();
  const drone = [at(tonic, 0, 2), at(tonic, 7, 2)];
  const bars = [steps, down, steps, down].map((pattern) => ({
    chord: drone,
    melody: run(tonic, pattern),
  }));
  return {
    name: `${minor ? 'minor' : 'major'} pentatonic solo, ${String(tonic)}`,
    group: 'solo',
    expected: {
      tonic,
      quality: minor ? 'minor' : 'major',
      scale: minor ? 'minorPentatonic' : 'majorPentatonic',
    },
    score: fromBars(bars),
  };
}

function powerChords(tonic: number): Piece {
  const power = (offset: number) => [
    at(tonic, offset, 2),
    at(tonic, offset + 7, 2),
    at(tonic, offset + 12, 2),
  ];
  const bars = [0, 0, 5, 5, 0, 0, 7, 5].map((offset) => ({ chord: power(offset) }));
  return {
    name: `power chord riff, ${String(tonic)}`,
    group: 'power chord',
    expected: { tonic, quality: 'none' },
    score: fromBars(bars),
  };
}

/**
 * A bass note a bar under a melody that decorates the key's chord tones with two chromatic tones
 * (a semitone above the tonic and the tritone). In pattern A the decoration sits on the offbeats;
 * in pattern B it is short next to the long chord tone. The factors that weigh a note by its beat
 * and by its length are what separate the two readings.
 */
function ornamented(tonic: number, minor: boolean, pattern: 'metric' | 'duration'): Piece {
  const third = minor ? 3 : 4;
  const tones = [0, third, 7, third];
  const decoration = [1, 6];
  // A melody alone: with a bass line under it the harmony would carry the key by itself.
  const builder = buildScore().track('piano', { name: 'Melody' });
  const roots = [0, 5, 7, 0];
  for (const root of roots) {
    builder.bar();
    for (let beat = 0; beat < (pattern === 'metric' ? 4 : 2); beat++) {
      const tone = at(tonic, (root + (tones[beat] ?? 0)) % 12, 5);
      const chroma = (slot: number) => at(tonic, decoration[slot % 2] ?? 1, 5);
      if (pattern === 'metric') {
        const off =
          beat % 2 === 0
            ? at(tonic, (root + (tones[(beat + 1) % 4] ?? 0)) % 12, 5)
            : chroma(beat >> 1);
        builder.beat('8', [midi(tone)]).beat('8', [midi(off)]);
      } else {
        builder.beat('4.', [midi(tone)]).beat('8', [midi(chroma(beat))]);
      }
    }
  }
  // It ends on the tonic, as a piece does.
  builder.bar().beat('1', [midi(at(tonic, 0, 5))]);
  return {
    name: `ornamented (${pattern}) ${minor ? 'minor' : 'major'}, ${String(tonic)}`,
    group: 'ornamented',
    expected: { tonic, quality: minor ? 'minor' : 'major' },
    score: builder.build(),
  };
}

/** Every generated piece in all 12 tonics, minor and major where the form has both. */
export function generatedCorpus(): Piece[] {
  const pieces: Piece[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    pieces.push(scaleRun(tonic, false), scaleRun(tonic, true));
    pieces.push(cadence(tonic, false), cadence(tonic, true));
    // I–vi–IV–V
    pieces.push(
      progression('I-vi-IV-V', tonic, false, [
        [0, 4],
        [9, 3],
        [5, 4],
        [7, 4],
      ]),
    );
    // i–♭VI–♭III–♭VII
    pieces.push(
      progression('i-bVI-bIII-bVII', tonic, true, [
        [0, 3],
        [8, 4],
        [3, 4],
        [10, 4],
      ]),
    );
    pieces.push(blues(tonic));
    pieces.push(
      vamp('Mixolydian I-bVII-IV', tonic, 'major', 'mixolydian', [
        [0, 4],
        [10, 4],
        [5, 4],
        [0, 4],
      ]),
      vamp('Dorian i-IV', tonic, 'minor', 'dorian', [
        [0, 3],
        [0, 3],
        [5, 4],
        [0, 3],
      ]),
      vamp('Phrygian i-bII', tonic, 'minor', 'phrygian', [
        [0, 3],
        [0, 3],
        [1, 4],
        [0, 3],
      ]),
    );
    pieces.push(solo(tonic, true), solo(tonic, false), powerChords(tonic));
    for (const minor of [false, true]) {
      pieces.push(ornamented(tonic, minor, 'metric'), ornamented(tonic, minor, 'duration'));
    }
  }
  return pieces;
}

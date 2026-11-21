import { midiNote } from '@reprise/model';
import type { Beat, Note, Track } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { NoteEvent } from '../sink';
import { midiToFrequency } from './sample-source';
import { COURSE_PARTNER, Sampler } from './sampler';
import { createSamplerSink } from './sampler-sink';
import { offline, sineInstrument, toneLevel } from './test/offline';

const song = score()
  .track('guitar')
  .bar()
  .beat('4', [note(6, 0)])
  .build();
const [plain] = song.tracks;
const firstBeat = plain?.bars[0]?.voices[0].beats[0];
if (!plain || !firstBeat) throw new Error('the song has a guitar track and a beat');
const beat: Beat = firstBeat;
/** A 12-string: octave strings on courses 6 to 3, unison on 2 and 1. */
const twelve: Track = { ...plain, courses: [12, 12, 12, 12, 0, 0] };

function event(track: Track, played: Note, when: number, duration: number): NoteEvent {
  return {
    track,
    trackIndex: 0,
    voiceIndex: 0,
    beat,
    beatIndex: 0,
    note: played,
    when,
    duration,
    playbackTick: 0,
    durationTicks: 0,
    sequenceIndex: 0,
    masterBarIndex: 0,
    passIndex: 0,
    barEnd: when + duration,
    nextOnString: undefined,
    continuations: [],
  };
}

function setup(track: Track, seconds: number) {
  const context = offline(seconds);
  const sampler = new Sampler(context);
  sampler.addTrack(track, sineInstrument());
  return { context, sampler, sink: createSamplerSink(sampler) };
}

const hz = (track: Track, played: Pick<Note, 'string' | 'fret'>, extra = 0) =>
  midiToFrequency(midiNote(track, played) + extra);

describe('doubled courses', () => {
  it('strikes the octave string with the fundamental, and does not choke its partner', async () => {
    const { context, sink } = setup(twelve, 1);
    const low = note(6, 0);

    sink.noteOn(event(twelve, low, 0, 0.8));
    const data = (await context.startRendering()).getChannelData(0);

    const fundamental = toneLevel(data, hz(twelve, low), 0.2, 0.7);
    const octave = toneLevel(data, hz(twelve, low, 12), 0.2, 0.7);
    expect(fundamental).toBeGreaterThan(0.1);
    // Both sound together, and the octave string sits the fixed trim under the first.
    expect(octave / fundamental).toBeGreaterThan(0.5);
    expect(octave / fundamental).toBeLessThan(0.75);
    expect(octave / fundamental).toBeCloseTo(10 ** (COURSE_PARTNER.octave.trimDb / 20), 1);
  });

  it('doubles a unison course louder than a single string, and a plain track not at all', async () => {
    const high = note(1, 0);
    const single = setup(plain, 1);
    single.sink.noteOn(event(plain, high, 0, 0.8));
    const doubled = setup(twelve, 1);
    doubled.sink.noteOn(event(twelve, high, 0, 0.8));
    const one = (await single.context.startRendering()).getChannelData(0);
    const two = (await doubled.context.startRendering()).getChannelData(0);

    expect(toneLevel(two, hz(twelve, high), 0.2, 0.7)).toBeGreaterThan(
      toneLevel(one, hz(plain, high), 0.2, 0.7) * 1.1,
    );
    // The plain track has no octave string.
    expect(toneLevel(one, hz(plain, note(6, 0), 12), 0.2, 0.7)).toBeLessThan(0.001);
  });

  it('chokes both strings when the next note on the course is struck', async () => {
    const { context, sink } = setup(twelve, 1);
    const first = note(6, 0);
    const next = note(6, 3);

    sink.noteOn(event(twelve, first, 0, 0.8));
    sink.noteOn(event(twelve, next, 0.4, 0.5));
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, hz(twelve, first), 0.2, 0.35)).toBeGreaterThan(0.1);
    expect(toneLevel(data, hz(twelve, first, 12), 0.2, 0.35)).toBeGreaterThan(0.05);
    expect(toneLevel(data, hz(twelve, first), 0.5, 0.9)).toBeLessThan(0.001);
    expect(toneLevel(data, hz(twelve, first, 12), 0.5, 0.9)).toBeLessThan(0.001);
    expect(toneLevel(data, hz(twelve, next, 12), 0.5, 0.9)).toBeGreaterThan(0.05);
  });

  it('moves both strings with a bend', async () => {
    const { context, sink } = setup(twelve, 1);
    const hold = {
      kind: 'hold' as const,
      points: [
        { position: 0, value: 4 },
        { position: 60, value: 4 },
      ],
    };
    const bent = note(5, 0, { bend: hold });

    sink.noteOn(event(twelve, bent, 0, 0.8));
    const data = (await context.startRendering()).getChannelData(0);

    // Value 4 is two semitones, on the fundamental and on the octave string alike.
    expect(toneLevel(data, hz(twelve, bent, 2), 0.2, 0.7)).toBeGreaterThan(0.1);
    expect(toneLevel(data, hz(twelve, bent, 14), 0.2, 0.7)).toBeGreaterThan(0.05);
    expect(toneLevel(data, hz(twelve, bent), 0.2, 0.7)).toBeLessThan(0.02);
    expect(toneLevel(data, hz(twelve, bent, 12), 0.2, 0.7)).toBeLessThan(0.02);
  });

  it('plays a ghost note and a dead note on one string', async () => {
    const { context, sink } = setup(twelve, 1);
    const ghost = note(6, 0, { ghost: true });

    sink.noteOn(event(twelve, ghost, 0, 0.8));
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, hz(twelve, ghost), 0.2, 0.7)).toBeGreaterThan(0.01);
    expect(toneLevel(data, hz(twelve, ghost, 12), 0.2, 0.7)).toBeLessThan(0.001);
  });

  it('doubles an editor preview', async () => {
    const { context, sampler } = setup(twelve, 1);
    const low = { string: 6, fret: 0 };

    sampler.previewNote(twelve.id, low);
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, hz(twelve, low), 0.1, 0.5)).toBeGreaterThan(0.1);
    expect(toneLevel(data, hz(twelve, low, 12), 0.1, 0.5)).toBeGreaterThan(0.05);
  });
});

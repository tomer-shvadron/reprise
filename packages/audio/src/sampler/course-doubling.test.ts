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

function event(
  track: Track,
  played: Note,
  when: number,
  duration: number,
  next?: NoteEvent['nextOnString'],
): NoteEvent {
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
    nextOnString: next,
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

  it('plays a ghost note and a dead note on one voice, and a plain note on two', () => {
    const voices = (played: Note): number => {
      const { sampler, sink } = setup(twelve, 1);
      sink.noteOn(event(twelve, played, 0, 0.8));
      return sampler.pool.active(0.01).length;
    };

    expect(voices(note(6, 0))).toBe(2);
    expect(voices(note(6, 0, { ghost: true }))).toBe(1);
    expect(voices(note(6, 0, { dead: true }))).toBe(1);
  });

  it('carries both strings through a legato slide without striking either again', async () => {
    const { context, sampler, sink } = setup(twelve, 1.2);
    const first = note(6, 0, { slide: ['legato'] });
    const second = note(6, 5);

    sink.noteOn(event(twelve, first, 0, 0.4, { note: second, beat, when: 0.4 }));
    sink.noteOn(event(twelve, second, 0.4, 0.5));
    // Two voices, not four: the slide's handle is the same pair into the second note.
    expect(sampler.pool.active(0.6).length).toBe(2);
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, hz(twelve, second), 0.6, 0.85)).toBeGreaterThan(0.1);
    expect(toneLevel(data, hz(twelve, second, 12), 0.6, 0.85)).toBeGreaterThan(0.05);
    expect(toneLevel(data, hz(twelve, first), 0.6, 0.85)).toBeLessThan(0.02);
  });

  it('keeps a let-ring note and its partner ringing until the next note on the string', async () => {
    const { context, sink } = setup(twelve, 1.5);
    const ring = note(6, 0, { letRing: true });
    const next = note(6, 7);

    // The bar runs past the note, so the let-ring holds both strings until the next strike.
    sink.noteOn({ ...event(twelve, ring, 0, 0.2), barEnd: 1.5 });
    sink.noteOn(event(twelve, next, 0.8, 0.4));
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, hz(twelve, ring), 0.4, 0.7)).toBeGreaterThan(0.1);
    expect(toneLevel(data, hz(twelve, ring, 12), 0.4, 0.7)).toBeGreaterThan(0.05);
    // Gone after the next strike (what is left is the master bus's harmonics of the new note).
    expect(toneLevel(data, hz(twelve, ring, 12), 1, 1.3)).toBeLessThan(0.01);
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

describe('a full pool', () => {
  it('steals a course partner before any fundamental', () => {
    const context = offline(1);
    // Room for two doubled strikes, so the third note must steal two voices.
    const sampler = new Sampler(context, { polyphony: 4 });
    sampler.addTrack(twelve, sineInstrument());
    const sink = createSamplerSink(sampler);
    const strings = [note(6, 0), note(5, 0), note(4, 0)];

    for (const [index, played] of strings.entries()) {
      sink.noteOn(event(twelve, played, index * 0.1, 0.8));
    }

    const voices = sampler.pool.active(0.25);
    expect(voices).toHaveLength(4);
    // The third strike's own pair stays, and of the first two only the fundamentals are left.
    expect(voices.filter((voice) => !voice.partner).map((voice) => voice.string)).toEqual([
      6, 5, 4,
    ]);
    expect(voices.filter((voice) => voice.partner)).toHaveLength(1);
    expect(sampler.pool.stolen).toBe(2);
  });
});

import { midiNote } from '@reprise/model';
import type { Beat, Note, Track } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { NoteEvent } from '../sink';
import { midiToFrequency } from './sample-source';
import { Sampler } from './sampler';
import { createSamplerSink } from './sampler-sink';
import { cents, offline, sineInstrument, toneLevel, zeroCrossingFrequency } from './test/offline';

const song = score()
  .track('guitar')
  .bar()
  .beat('4', [note(1, 5)])
  .beat('4', [note(1, 7, { letRing: true })])
  .beat('2', [note(1, 8)])
  .track('bass')
  .bar()
  .beat('1', [note(1, 0)])
  .build();
const [guitar, bass] = song.tracks;
if (!guitar || !bass) throw new Error('the song has two tracks');
const [first, ringing, last] = guitar.bars[0]?.voices[0].beats ?? [];
const firstNote = first?.notes[0];
const ringingNote = ringing?.notes[0];
const lastNote = last?.notes[0];
if (!first || !ringing || !last || !firstNote || !ringingNote || !lastNote) {
  throw new Error('the guitar bar has three notes');
}
const guitarTrack: Track = guitar;

/** A scheduler event for the guitar's first voice; `barEnd` defaults to the note's own end. */
function event(spec: {
  note: Note;
  beat: Beat;
  when: number;
  duration: number;
  barEnd?: number;
}): NoteEvent {
  return {
    track: guitarTrack,
    trackIndex: 0,
    voiceIndex: 0,
    beat: spec.beat,
    beatIndex: 0,
    note: spec.note,
    when: spec.when,
    duration: spec.duration,
    playbackTick: 0,
    durationTicks: 0,
    sequenceIndex: 0,
    masterBarIndex: 0,
    passIndex: 0,
    barEnd: spec.barEnd ?? spec.when + spec.duration,
    nextOnString: undefined,
    continuations: [],
  };
}

describe('previewNote', () => {
  it('plays the note at its pitch through its own strip', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(guitar, sineInstrument());
    sampler.addTrack(bass, sineInstrument());

    const voice = sampler.previewNote(guitar.id, firstNote);
    const data = (await context.startRendering()).getChannelData(0);

    const expected = midiToFrequency(midiNote(guitar, firstNote));
    expect(Math.abs(cents(zeroCrossingFrequency(data, 0.1, 0.5), expected))).toBeLessThan(1);
    expect(voice?.endTime).toBeLessThan(1);
    expect(toneLevel(data, expected, 0.8, 1)).toBeLessThan(0.001);
  });

  it('sounds on a muted track and beside a soloed one, and the gate still holds for playback', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack({ ...guitar, channel: { ...guitar.channel, solo: true } }, sineInstrument());
    sampler.addTrack({ ...bass, channel: { ...bass.channel, mute: true } }, sineInstrument());
    const previewed = midiToFrequency(midiNote(bass, note(1, 0)));
    const played = midiToFrequency(midiNote(bass, note(2, 0)));

    sampler.previewNote(bass.id, note(1, 0));
    sampler.noteOn(bass.id, { key: midiNote(bass, note(2, 0)), velocity: 96, when: 0 });
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, previewed, 0.1, 0.5)).toBeGreaterThan(0.1);
    expect(toneLevel(data, played, 0.1, 0.5)).toBeLessThan(0.001);
  });
});

describe('createSamplerSink', () => {
  it('plays scheduler events, letting a let-ring note ring to the next note on its string', async () => {
    const context = offline(1.5);
    const sampler = new Sampler(context);
    sampler.addTrack(guitar, sineInstrument());
    const sink = createSamplerSink(sampler);

    sink.noteOn(event({ note: firstNote, beat: first, when: 0, duration: 0.25, barEnd: 1.25 }));
    sink.noteOn(
      event({ note: ringingNote, beat: ringing, when: 0.25, duration: 0.25, barEnd: 1.25 }),
    );
    sink.noteOn(event({ note: lastNote, beat: last, when: 0.75, duration: 0.5, barEnd: 1.25 }));
    sink.allNotesOff(1.25);
    const data = (await context.startRendering()).getChannelData(0);

    const pitch = (n: typeof firstNote) => midiToFrequency(midiNote(guitar, n));
    expect(toneLevel(data, pitch(firstNote), 0.4, 0.7)).toBeLessThan(0.001);
    expect(toneLevel(data, pitch(ringingNote), 0.5, 0.7)).toBeGreaterThan(0.1);
    expect(toneLevel(data, pitch(ringingNote), 0.85, 1.2)).toBeLessThan(0.001);
    expect(toneLevel(data, pitch(lastNote), 0.85, 1.2)).toBeGreaterThan(0.1);
    expect(toneLevel(data, pitch(lastNote), 1.35, 1.5)).toBeLessThan(0.001);
  });

  it('releases a let-ring note at the bar end the scheduler supplies', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(guitar, sineInstrument());
    const sink = createSamplerSink(sampler);

    sink.noteOn(event({ note: ringingNote, beat: ringing, when: 0, duration: 0.2, barEnd: 0.6 }));
    const data = (await context.startRendering()).getChannelData(0);

    const frequency = midiToFrequency(midiNote(guitar, ringingNote));
    expect(toneLevel(data, frequency, 0.3, 0.55)).toBeGreaterThan(0.1);
    expect(toneLevel(data, frequency, 0.7, 1)).toBeLessThan(0.001);
  });

  it('cancels a note scheduled ahead when allNotesOff comes first', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(guitar, sineInstrument());
    const sink = createSamplerSink(sampler);

    sink.noteOn(event({ note: firstNote, beat: first, when: 0.5, duration: 0.4 }));
    sink.allNotesOff(0.2);
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, midiToFrequency(midiNote(guitar, firstNote)), 0.5, 1)).toBeLessThan(
      0.001,
    );
  });
});

import { midiNote } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

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

describe('previewNote', () => {
  it('plays the note at its pitch through its own strip', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(guitar, sineInstrument());
    sampler.addTrack({ ...bass, channel: { ...bass.channel, mute: true } }, sineInstrument());

    expect(sampler.previewNote(bass.id, note(1, 0))).toBeDefined();
    const voice = sampler.previewNote(guitar.id, firstNote);
    const data = (await context.startRendering()).getChannelData(0);

    const expected = midiToFrequency(midiNote(guitar, firstNote));
    expect(Math.abs(cents(zeroCrossingFrequency(data, 0.1, 0.5), expected))).toBeLessThan(1);
    expect(toneLevel(data, midiToFrequency(midiNote(bass, note(1, 0))), 0.1, 0.5)).toBeLessThan(
      0.001,
    );
    expect(voice?.endTime).toBeLessThan(1);
    expect(toneLevel(data, expected, 0.8, 1)).toBeLessThan(0.001);
  });
});

describe('createSamplerSink', () => {
  it('plays scheduler events, letting a let-ring note ring to the next note on its string', async () => {
    const context = offline(1.5);
    const sampler = new Sampler(context);
    sampler.addTrack(guitar, sineInstrument());
    const sink = createSamplerSink(sampler);

    sink.noteOn(guitar, firstNote, first, 0, 0.25);
    sink.noteOn(guitar, ringingNote, ringing, 0.25, 0.25);
    sink.noteOn(guitar, lastNote, last, 0.75, 0.5);
    sink.allNotesOff(1.25);
    const data = (await context.startRendering()).getChannelData(0);

    const pitch = (n: typeof firstNote) => midiToFrequency(midiNote(guitar, n));
    expect(toneLevel(data, pitch(firstNote), 0.4, 0.7)).toBeLessThan(0.001);
    expect(toneLevel(data, pitch(ringingNote), 0.5, 0.7)).toBeGreaterThan(0.1);
    expect(toneLevel(data, pitch(ringingNote), 0.85, 1.2)).toBeLessThan(0.001);
    expect(toneLevel(data, pitch(lastNote), 0.85, 1.2)).toBeGreaterThan(0.1);
    expect(toneLevel(data, pitch(lastNote), 1.35, 1.5)).toBeLessThan(0.001);
  });
});

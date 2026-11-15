import { midiNote } from '@reprise/model';
import type { Track } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { RegionMap } from './region-map';
import type { SampleSource } from './sample-source';
import { midiToFrequency } from './sample-source';
import { Sampler } from './sampler';
import type { Instrument } from './sampler';
import { offline, peak, region, sineInstrument, toneLevel } from './test/offline';

const song = score()
  .track('guitar')
  .bar()
  .beat('1', [note(1, 5)])
  .build();
const guitar: Track | undefined = song.tracks[0];
if (!guitar) throw new Error('the song has a track');

/** A sample that is not resident until `open()`, as a first preview of an instrument finds it. */
function gated(): { instrument: Instrument; open: () => void } {
  const buffer = sineInstrument().source.peekBuffer('a440');
  if (!buffer) throw new Error('the synthetic sample is resident');
  let resident = false;
  let resolve: (value: AudioBuffer) => void = () => undefined;
  const loading = new Promise<AudioBuffer>((done) => {
    resolve = done;
  });
  const source: SampleSource = {
    getBuffer: () => loading,
    peekBuffer: () => (resident ? buffer : undefined),
  };
  return {
    instrument: { regions: new RegionMap([region()]), source },
    open: () => {
      resident = true;
      resolve(buffer);
    },
  };
}

const flush = () => new Promise<void>((done) => setTimeout(done, 0));

/** Runs `action` while the render is suspended at `at` seconds. */
function at(context: OfflineAudioContext, time: number, action: () => void | Promise<void>): void {
  void context.suspend(time).then(async () => {
    await action();
    await flush();
    await context.resume();
  });
}

const frequencyOf = (fret: number, string = 1) =>
  midiToFrequency(midiNote(guitar, { string, fret }));

describe('previewNote with the sample still decoding', () => {
  it('starts the note when the decode lands, not before', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    const source = gated();
    sampler.addTrack(guitar, source.instrument);

    expect(sampler.previewNote(guitar.id, { string: 1, fret: 5 })).toBeUndefined();
    expect(sampler.misses).toBe(1);
    at(context, 0.2, source.open);
    const data = (await context.startRendering()).getChannelData(0);

    expect(peak(data, 0, 0.19)).toBe(0);
    expect(toneLevel(data, frequencyOf(5), 0.25, 0.5)).toBeGreaterThan(0.1);
  });

  it('cuts the late note by the wait', async () => {
    const context = offline(1.2);
    const sampler = new Sampler(context);
    const source = gated();
    sampler.addTrack(guitar, source.instrument);

    sampler.previewNote(guitar.id, { string: 1, fret: 5 }, { seconds: 0.4 });
    at(context, 0.3, source.open);
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, frequencyOf(5), 0.32, 0.38)).toBeGreaterThan(0.1);
    expect(peak(data, 0.55, 1.2)).toBeLessThan(0.001);
  });

  it('drops a note whose decode lands too late', async () => {
    const context = offline(1.5);
    const sampler = new Sampler(context);
    const source = gated();
    sampler.addTrack(guitar, source.instrument);

    sampler.previewNote(guitar.id, { string: 1, fret: 5 });
    at(context, 0.9, source.open);
    const data = (await context.startRendering()).getChannelData(0);

    expect(peak(data, 0, 1.5)).toBe(0);
  });

  it.each([
    [
      'removeTrack',
      (sampler: Sampler) => {
        sampler.removeTrack(guitar.id);
      },
    ],
    [
      'dispose',
      (sampler: Sampler) => {
        sampler.dispose();
      },
    ],
    ['re-addTrack', (sampler: Sampler) => sampler.addTrack(guitar, { ...gated().instrument })],
    [
      'a stop',
      (sampler: Sampler) => {
        sampler.allNotesOff(0.05);
      },
    ],
  ])('drops the waiting note after %s', async (_name, cancel) => {
    const context = offline(1);
    const sampler = new Sampler(context);
    const source = gated();
    sampler.addTrack(guitar, source.instrument);

    sampler.previewNote(guitar.id, { string: 1, fret: 5 });
    cancel(sampler);
    at(context, 0.1, source.open);
    const data = (await context.startRendering()).getChannelData(0);

    expect(peak(data, 0, 1)).toBe(0);
  });

  it('plays only the last of several previews waiting on one decode', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    const source = gated();
    sampler.addTrack(guitar, source.instrument);

    sampler.previewNote(guitar.id, { string: 1, fret: 5 });
    sampler.previewNote(guitar.id, { string: 1, fret: 7 });
    sampler.previewNote(guitar.id, { string: 1, fret: 9 });
    sampler.previewNote(guitar.id, { pitch: 60 });
    sampler.previewNote(guitar.id, { pitch: 60 });
    sampler.previewNote(guitar.id, { pitch: 72 });
    at(context, 0.1, source.open);
    const data = (await context.startRendering()).getChannelData(0);

    const level = (frequency: number) => toneLevel(data, frequency, 0.15, 0.5);
    expect(level(frequencyOf(9))).toBeGreaterThan(0.1);
    expect(level(frequencyOf(5))).toBeLessThan(0.001);
    expect(level(frequencyOf(7))).toBeLessThan(0.001);
    // Two keys, each its own slot: the repeated 60 sounds once, and 72 beside it.
    expect(level(midiToFrequency(72))).toBeGreaterThan(0.1);
    expect(level(midiToFrequency(60))).toBeGreaterThan(0.1);
  });
});

describe('preview voices and the song', () => {
  it('does not choke a song note on its string, and is not choked by it', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(guitar, sineInstrument());

    sampler.noteOn(guitar.id, {
      key: midiNote(guitar, { string: 1, fret: 5 }),
      velocity: 96,
      when: 0,
      string: 1,
    });
    sampler.previewNote(guitar.id, { string: 1, fret: 9 });
    sampler.noteOn(guitar.id, {
      key: midiNote(guitar, { string: 1, fret: 7 }),
      velocity: 96,
      when: 0.4,
      string: 1,
    });
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, frequencyOf(5), 0.1, 0.35)).toBeGreaterThan(0.1);
    expect(toneLevel(data, frequencyOf(9), 0.45, 0.55)).toBeGreaterThan(0.1);
  });

  it('chokes a preview with the next preview on its string, and a pitch with its own key', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(guitar, sineInstrument());

    sampler.previewNote(guitar.id, { string: 1, fret: 5 });
    sampler.previewNote(guitar.id, { string: 1, fret: 7 });
    sampler.previewNote(guitar.id, { pitch: 60 }, { seconds: 0.2 });
    sampler.previewNote(guitar.id, { pitch: 72 });
    const data = (await context.startRendering()).getChannelData(0);

    expect(toneLevel(data, frequencyOf(5), 0.2, 0.5)).toBeLessThan(0.001);
    expect(toneLevel(data, frequencyOf(7), 0.2, 0.5)).toBeGreaterThan(0.1);
    expect(toneLevel(data, midiToFrequency(72), 0.2, 0.5)).toBeGreaterThan(0.1);
  });
});

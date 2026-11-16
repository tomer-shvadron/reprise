import { PPQ } from '@reprise/model';
import type { Beat, Note, Track } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { Voicing } from '../articulations/sets';
import type { NoteEvent } from '../sink';
import { RegionMap } from './region-map';
import type { Region } from './region-map';
import { SynthSampleSource } from './sample-source';
import { Sampler } from './sampler';
import type { Instrument } from './sampler';
import { createSamplerSink } from './sampler-sink';
import type { SamplerSinkOptions } from './sampler-sink';
import { SAMPLE_RATE, offline, region, toneLevel } from './test/offline';

const song = score()
  .track('guitar')
  .bar()
  .beat('4', [note(1, 5)])
  .beat('4', [note(1, 5, { hammerPull: true })])
  .build();
const [guitar] = song.tracks;
const [plain, hammered] = guitar?.bars[0]?.voices[0].beats ?? [];
if (!guitar || !plain || !hammered) throw new Error('the song has two beats');
const track: Track = guitar;

function event(beat: Beat, noteOf: Note, when: number, sequenceIndex = 0): NoteEvent {
  return {
    track,
    trackIndex: 0,
    voiceIndex: 0,
    beat,
    beatIndex: 0,
    note: noteOf,
    when,
    duration: 0.3,
    playbackTick: 0,
    durationTicks: PPQ / 4,
    sequenceIndex,
    masterBarIndex: 0,
    passIndex: 0,
    barEnd: when + 0.3,
    nextOnString: undefined,
    continuations: [],
  };
}

const sine = (frequency: number) => ({ kind: 'sine', frequency, duration: 3 }) as const;

function run(
  regions: Region[],
  options: SamplerSinkOptions,
  play: (sink: ReturnType<typeof createSamplerSink>) => void,
) {
  const context = offline(1.6);
  const sampler = new Sampler(context);
  sampler.master.input.disconnect();
  sampler.master.input.connect(context.destination);
  const instrument: Instrument = {
    regions: new RegionMap(regions),
    source: new SynthSampleSource(SAMPLE_RATE, { a: sine(440), b: sine(660), c: sine(770) }),
  };
  sampler.addTrack(track, instrument);
  play(createSamplerSink(sampler, options));
  return context.startRendering().then((buffer) => buffer.getChannelData(0));
}

const rootKey = 69;
const at69 = { keyLo: 69, keyHi: 69, rootKey };

describe('the sampler sink fills select', () => {
  const robin = [
    region({ ...at69, sample: 'a', sequence: { length: 2, position: 1 } }),
    region({ ...at69, sample: 'b', sequence: { length: 2, position: 2 } }),
  ];
  const fret = note(1, 5);
  // string 1 of the default tuning is E4 (64) and fret 5 makes 69, the one key the regions cover.

  it('rotates a round robin per key and starts over after allNotesOff', async () => {
    const data = await run(robin, {}, (sink) => {
      sink.noteOn(event(plain, fret, 0));
      sink.noteOn(event(plain, fret, 0.4));
      sink.noteOn(event(plain, fret, 0.8));
      sink.allNotesOff(1.1);
      sink.noteOn(event(plain, fret, 1.2));
    });
    expect(toneLevel(data, 440, 0.05, 0.3)).toBeGreaterThan(0.05);
    expect(toneLevel(data, 660, 0.45, 0.7)).toBeGreaterThan(0.05);
    expect(toneLevel(data, 440, 0.85, 1.1)).toBeGreaterThan(0.05);
    expect(toneLevel(data, 440, 1.25, 1.5)).toBeGreaterThan(0.05);
  });

  it('draws the same random take for the same note and pass, wherever the run starts', async () => {
    const chance = [
      region({ ...at69, sample: 'a', random: { lo: 0, hi: 0.5 } }),
      region({ ...at69, sample: 'b', random: { lo: 0.5, hi: 1 } }),
    ];
    const taken = async (): Promise<[number, number]> => {
      const data = await run(chance, {}, (sink) => {
        sink.noteOn(event(plain, fret, 0));
      });
      return [toneLevel(data, 440, 0.05, 0.3), toneLevel(data, 660, 0.05, 0.3)];
    };
    const [first, second] = [await taken(), await taken()];
    expect(first).toEqual(second);
    expect(first[0] + first[1]).toBeGreaterThan(0.05);
    expect(Math.min(...first)).toBeLessThan(0.001);
  });

  it('starts the legato regions on a hammer-on when the voicing has a legato trigger', async () => {
    const regions = [
      region({ ...at69, sample: 'a', trigger: 'first' }),
      region({ ...at69, sample: 'c', trigger: 'legato' }),
    ];
    const hammer = hammered.notes[0] ?? fret;
    const play = (sink: ReturnType<typeof createSamplerSink>) => {
      sink.noteOn(event(plain, fret, 0));
      sink.noteOn(event(hammered, hammer, 0.5));
    };
    const voicing: Voicing = { sets: {}, legatoTrigger: true };
    const withVoicing = await run(regions, { voicingOf: () => voicing }, play);
    expect(toneLevel(withVoicing, 440, 0.05, 0.3)).toBeGreaterThan(0.05);
    expect(toneLevel(withVoicing, 770, 0.55, 0.8)).toBeGreaterThan(0.05);
    expect(toneLevel(withVoicing, 440, 0.55, 0.8)).toBeLessThan(0.001);

    // Without a resolver nothing changes: the hammer-on is struck like any note.
    const without = await run(regions, {}, play);
    expect(toneLevel(without, 440, 0.55, 0.8)).toBeGreaterThan(0.05);
    expect(toneLevel(without, 770, 0.55, 0.8)).toBeLessThan(0.001);
  });
});

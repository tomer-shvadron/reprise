import { PPQ } from '@reprise/model';
import type { Beat, Note, Track } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { NoteEvent } from '../sink';
import { RegionMap } from './region-map';
import { SynthSampleSource } from './sample-source';
import { Sampler } from './sampler';
import type { NoteOnRequest } from './sampler';
import { createSamplerSink } from './sampler-sink';
import { SAMPLE_RATE, offline, region, toneLevel } from './test/offline';

const main = note(1, 5);
const song = score()
  .track('guitar')
  .bar()
  .beat('4', [main])
  .beat('4', [note(1, 5)], { effects: { tremoloPicking: 16 } })
  .beat('4', [note(1, 5)], {
    grace: [{ duration: 16, before: true, notes: [note(1, 3)] }],
  })
  .build();
const [guitar] = song.tracks;
const [plain, tremolo, graced] = guitar?.bars[0]?.voices[0].beats ?? [];
if (!guitar || !plain || !tremolo || !graced) throw new Error('the song has three beats');
const track: Track = guitar;

function event(beat: Beat, when: number, next?: { note: Note; when: number }): NoteEvent {
  const first: Note | undefined = beat.notes[0];
  if (!first) throw new Error('a beat with a note');
  return {
    track,
    trackIndex: 0,
    voiceIndex: 0,
    beat,
    beatIndex: 0,
    note: first,
    when,
    duration: 0.5,
    playbackTick: 0,
    durationTicks: PPQ,
    sequenceIndex: 0,
    masterBarIndex: 0,
    passIndex: 0,
    barEnd: when + 2,
    nextOnString: next && { ...next, beat },
    continuations: [],
  };
}

/** The `noteOn` requests a sink makes for one beat, in order. */
function setup(seconds: number) {
  const context = offline(seconds);
  const sampler = new Sampler(context);
  sampler.master.input.disconnect();
  sampler.master.input.connect(context.destination);
  sampler.addTrack(track, {
    regions: new RegionMap([
      region({ sample: 'a' }),
      region({ sample: 'tail', trigger: 'release' }),
    ]),
    source: new SynthSampleSource(SAMPLE_RATE, {
      a: { kind: 'sine', frequency: 440, duration: 2 },
      tail: { kind: 'sine', frequency: 1100, duration: 0.2 },
    }),
  });
  return { context, sampler };
}

function requests(beat: Beat, next?: { note: Note; when: number }): NoteOnRequest[] {
  const { sampler } = setup(1);
  const made: NoteOnRequest[] = [];
  const original = sampler.noteOn.bind(sampler);
  sampler.noteOn = (id, request) => {
    made.push(request);
    return original(id, request);
  };
  createSamplerSink(sampler).noteOn(event(beat, 0.5, next));
  return made;
}

describe('the sampler sink sets releaseTrigger', () => {
  it('fires a plain note', () => {
    expect(requests(plain).map((r) => r.releaseTrigger)).toEqual([true]);
  });

  it('fires only the last stroke of a tremolo-picked note', () => {
    const made = requests(tremolo).map((r) => r.releaseTrigger);
    expect(made.length).toBeGreaterThan(1);
    expect(made.slice(0, -1).every((trigger) => trigger === false)).toBe(true);
    expect(made.at(-1)).toBe(true);
  });

  it('does not fire a grace note, only the main note it leads into', () => {
    const made = requests(graced).map((r) => r.releaseTrigger);
    expect(made).toEqual([false, true]);
  });
});

describe('the sampler sink and a hammer-on or pull-off chain', () => {
  const hammered = note(1, 5, { hammerPull: true });

  it('keeps the release sample of a note a hammer-on starts from, and fires the last note', () => {
    expect(requests(plain, { note: hammered, when: 1 }).map((r) => r.releaseTrigger)).toEqual([
      false,
    ]);
    expect(requests(plain, { note: main, when: 1 }).map((r) => r.releaseTrigger)).toEqual([true]);
  });

  it('fires it when the string is let go before the hammer-on', () => {
    expect(requests(plain, { note: hammered, when: 1.2 }).map((r) => r.releaseTrigger)).toEqual([
      true,
    ]);
  });

  it('plays one release sample for the chain, at its last note, not at the next onset', async () => {
    const { context, sampler } = setup(2);
    const sink = createSamplerSink(sampler);
    sink.noteOn(event(plain, 0.5, { note: hammered, when: 1 }));
    sink.noteOn({ ...event(plain, 1), note: hammered });
    const data = (await context.startRendering()).getChannelData(0);
    expect(toneLevel(data, 1100, 1.02, 1.18)).toBeLessThan(0.001);
    expect(toneLevel(data, 1100, 1.52, 1.68)).toBeGreaterThan(0.05);
  });
});

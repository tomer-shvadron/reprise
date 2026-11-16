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
import { SAMPLE_RATE, offline, region } from './test/offline';

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

function event(beat: Beat, when: number): NoteEvent {
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
    nextOnString: undefined,
    continuations: [],
  };
}

/** The `noteOn` requests a sink makes for one beat, in order. */
function requests(beat: Beat): NoteOnRequest[] {
  const context = offline(1);
  const sampler = new Sampler(context);
  sampler.addTrack(track, {
    regions: new RegionMap([
      region({ sample: 'a' }),
      region({ sample: 'tail', trigger: 'release' }),
    ]),
    source: new SynthSampleSource(SAMPLE_RATE, {
      a: { kind: 'sine', frequency: 440, duration: 1 },
      tail: { kind: 'sine', frequency: 1100, duration: 0.2 },
    }),
  });
  const made: NoteOnRequest[] = [];
  const original = sampler.noteOn.bind(sampler);
  sampler.noteOn = (id, request) => {
    made.push(request);
    return original(id, request);
  };
  createSamplerSink(sampler).noteOn(event(beat, 0.5));
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

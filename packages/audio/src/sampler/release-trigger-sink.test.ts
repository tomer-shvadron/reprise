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
  .beat('4', [note(1, 7)], { effects: { tapping: true } })
  .build();
const [guitar] = song.tracks;
const [plain, tremolo, graced, tapped] = guitar?.bars[0]?.voices[0].beats ?? [];
if (!guitar || !plain || !tremolo || !graced || !tapped) throw new Error('the song has four beats');
const track: Track = guitar;

type Next = { note: Note; when: number; beat?: Beat };

function event(beat: Beat, when: number, next?: Next): NoteEvent {
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
    nextOnString: next && { beat, ...next },
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

function requests(beat: Beat, next?: Next, noteOf?: Note): NoteOnRequest[] {
  const { sampler } = setup(1);
  const made: NoteOnRequest[] = [];
  const original = sampler.noteOn.bind(sampler);
  sampler.noteOn = (id, request) => {
    made.push(request);
    return original(id, request);
  };
  createSamplerSink(sampler).noteOn({ ...event(beat, 0.5, next), ...(noteOf && { note: noteOf }) });
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

  it('keeps the release sample of a note a tapped note follows, like a hammer-on', () => {
    const next = { note: note(1, 7), when: 1, beat: tapped };
    expect(requests(plain, next).map((r) => r.releaseTrigger)).toEqual([false]);
    expect(requests(plain, { ...next, when: 1.2 }).map((r) => r.releaseTrigger)).toEqual([true]);
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

  it('fires it when the hammered note has a grace note on its beat, struck before it', () => {
    const withGrace = score()
      .track('guitar')
      .bar()
      .beat('4', [hammered], { grace: [{ duration: 16, before: false, notes: [note(1, 3)] }] })
      .build().tracks[0]?.bars[0]?.voices[0].beats[0];
    if (!withGrace) throw new Error('a beat');
    const next = { note: hammered, when: 1, beat: withGrace };
    expect(requests(plain, next).map((r) => r.releaseTrigger)).toEqual([true]);
  });

  it('keeps the chain when the next note has a grace note on another string', () => {
    const withGrace = score()
      .track('guitar')
      .bar()
      .beat('4', [hammered], { grace: [{ duration: 16, before: false, notes: [note(2, 3)] }] })
      .build().tracks[0]?.bars[0]?.voices[0].beats[0];
    if (!withGrace) throw new Error('a beat');
    const next = { note: hammered, when: 1, beat: withGrace };
    // The grace note is struck on string 2, so string 1 is still held when the hammer-on comes.
    expect(requests(plain, next).map((r) => r.releaseTrigger)).toEqual([false]);
  });

  it('compares the hammer-on with the let-ring end, when the note rings on', () => {
    const ringing = note(1, 5, { letRing: true });
    // The ring is released at the bar end (2.5 s here), not at the note's own end.
    expect(
      requests(plain, { note: hammered, when: 2.5 }, ringing).map((r) => r.releaseTrigger),
    ).toEqual([false]);
  });

  it('plays one release sample for a three-note chain, at the last note', async () => {
    const { context, sampler } = setup(2.5);
    const sink = createSamplerSink(sampler);
    sink.noteOn(event(plain, 0.5, { note: hammered, when: 1 }));
    sink.noteOn({ ...event(plain, 1, { note: hammered, when: 1.5 }), note: hammered });
    sink.noteOn({ ...event(plain, 1.5), note: hammered });
    const data = (await context.startRendering()).getChannelData(0);
    expect(toneLevel(data, 1100, 1.02, 1.18)).toBeLessThan(0.001);
    expect(toneLevel(data, 1100, 1.52, 1.68)).toBeLessThan(0.001);
    expect(toneLevel(data, 1100, 2.02, 2.18)).toBeGreaterThan(0.05);
  });

  // Known and deliberate (README): a legato slide's carried voice keeps the release decision made
  // at the first note, where the next note was a slide target, not a hammer-on. In `7/9h11` the
  // chain therefore plays two release samples, one at the hammer-on's onset and one at its end.
  // Fixing it needs a way to drop the trigger on an existing VoiceHandle; this pins today's result.
  it('plays two release samples for a legato slide into a hammer-on (known)', async () => {
    const { context, sampler } = setup(2.5);
    const sink = createSamplerSink(sampler);
    const slid = note(1, 5, { slide: ['legato'] });
    const target = note(1, 5);
    sink.noteOn({ ...event(plain, 0.5, { note: target, when: 1 }), note: slid });
    sink.noteOn({ ...event(plain, 1, { note: hammered, when: 1.5 }), note: target });
    sink.noteOn({ ...event(plain, 1.5), note: hammered });
    const data = (await context.startRendering()).getChannelData(0);
    expect(toneLevel(data, 1100, 1.02, 1.18)).toBeLessThan(0.001);
    expect(toneLevel(data, 1100, 1.52, 1.68)).toBeGreaterThan(0.05);
    expect(toneLevel(data, 1100, 2.02, 2.18)).toBeGreaterThan(0.05);
  });
});

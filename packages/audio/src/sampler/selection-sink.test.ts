import { PPQ } from '@reprise/model';
import type { Beat, Track } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { GUITAR_SELECTION, syntheticGuitarPack } from '@reprise/audio/testing';
import { describe, expect, it } from 'vitest';

import { ARTICULATION } from '../articulations/parameters';
import { loadSfz } from '../sfz/load';
import type { NoteEvent } from '../sink';
import { RegionMap } from './region-map';
import { SynthSampleSource } from './sample-source';
import { Sampler } from './sampler';
import type { NoteOnRequest } from './sampler';
import { createSamplerSink } from './sampler-sink';
import { SAMPLE_RATE, offline } from './test/offline';

const { velocity, sequence, random, legato } = GUITAR_SELECTION;

// String 1 of the builder's guitar is E4 (64): fret = key - 64 is not reachable for keys 30 to 33,
// so each test hands the sink a track whose tuning puts the key on an open string.
const tuning = (key: number): number[] => [key];

async function regionsOf() {
  const pack = syntheticGuitarPack({ selection: true });
  const { regions } = await loadSfz('default.sfz', pack.files.read.bind(pack.files), {
    packId: 'guitar',
  });
  return new RegionMap(regions);
}

const beatsOf = (key: number, count: number, dynamics: 'pp' | 'f' = 'f') => {
  const builder = score()
    .track('guitar', { tuning: tuning(key) })
    .bar();
  for (let index = 0; index < count; index += 1) {
    builder.beat('8', [note(1, 0, { dynamics, id: `rnote${String(index).padStart(7, '0')}` })]);
  }
  return builder.build();
};

interface Strike {
  request: NoteOnRequest;
  sample: string | undefined;
}

/** What the sink asks of the sampler and the take the map gives each request, in order. */
async function strikes(
  song: ReturnType<typeof beatsOf>,
  options: { passes?: number; from?: number; previewAt?: number } = {},
): Promise<Strike[]> {
  const regions = await regionsOf();
  const sampler = new Sampler(offline(1));
  const [track] = song.tracks;
  if (!track) throw new Error('a track');
  sampler.addTrack(track, { regions, source: new SynthSampleSource(SAMPLE_RATE, {}) });
  const made: NoteOnRequest[] = [];
  const original = sampler.noteOn.bind(sampler);
  sampler.noteOn = (id, request) => {
    made.push(request);
    return original(id, request);
  };
  const sink = createSamplerSink(sampler, {
    voicingFor: () => ({ sets: {}, legatoTrigger: true }),
  });
  const beats: Beat[] = song.tracks[0]?.bars[0]?.voices[0].beats ?? [];
  for (let pass = 0; pass < (options.passes ?? 1); pass += 1) {
    for (const [index, beat] of beats.entries()) {
      if (index < (options.from ?? 0)) continue;
      if (beat.notes.length === 0) continue;
      // An editor preview of the beat, struck just before the song's own.
      if (index === options.previewAt) {
        sink.noteOn({ ...eventOf(track, beats, index, pass), preview: true });
      }
      sink.noteOn(eventOf(track, beats, index, pass));
    }
    sink.allNotesOff(0);
  }
  return made.map((request) => ({
    request,
    sample: regions
      .resolveAll(request.key, request.velocity, request.layer, request.select)[0]
      ?.sample.split('/')
      .pop(),
  }));
}

function eventOf(track: Track, beats: Beat[], index: number, passIndex: number): NoteEvent {
  const beat = beats[index];
  const first = beat?.notes[0];
  if (!beat) throw new Error('a beat');
  // The next note on the string, as the scheduler hands it: a rest between leaves a gap.
  const nextIndex = beats.findIndex((other, at) => at > index && other.notes.length > 0);
  const nextBeat = beats[nextIndex];
  const nextNote = nextBeat?.notes[0];
  if (!first) throw new Error('a note');
  return {
    track,
    trackIndex: 0,
    voiceIndex: 0,
    beat,
    beatIndex: index,
    note: first,
    when: 0.1 + index * 0.1,
    duration: 0.1,
    playbackTick: index * (PPQ / 2),
    durationTicks: PPQ / 2,
    // The bar's place in the playback sequence: one value for a bar, higher on a repeat.
    sequenceIndex: passIndex,
    masterBarIndex: 0,
    passIndex,
    barEnd: 5,
    nextOnString: nextBeat &&
      nextNote && { note: nextNote, beat: nextBeat, when: 0.1 + nextIndex * 0.1 },
    continuations: [],
  };
}

const take = (hertz: number): string => `take${String(hertz)}.wav`;

describe('the sink selects takes from the synthetic guitar pack', () => {
  it('rotates a key through its round-robin takes in order, and starts over', async () => {
    const made = await strikes(beatsOf(sequence.key, 4));
    expect(made.map((strike) => strike.sample)).toEqual(
      [...sequence.tones, sequence.tones[0]].map(take),
    );
  });

  it('starts the rotation again after a stop, so a repeat plays the same takes', async () => {
    const made = await strikes(beatsOf(sequence.key, 2), { passes: 2 });
    expect(made.map((strike) => strike.sample)).toEqual(
      [sequence.tones[0], sequence.tones[1], sequence.tones[0], sequence.tones[1]].map(take),
    );
  });

  it('picks the velocity layer by the note velocity', async () => {
    const soft = await strikes(beatsOf(velocity.key, 1, 'pp'));
    const loud = await strikes(beatsOf(velocity.key, 1));
    expect(soft[0]?.sample).toBe(take(velocity.tones[0]));
    expect(loud[0]?.sample).toBe(take(velocity.tones[1]));
  });

  describe('the random takes', () => {
    const song = beatsOf(random.key, 6);
    const samples = (made: Strike[]) => made.map((strike) => strike.sample);
    // Drawn from the note's id, the pass and the strike alone, so these are fixed.
    const SECOND_PASS = [1700, 1600, 1500, 1700, 1500, 1700].map(take);
    const FIRST_PASS = [1700, 1600, 1500, 1500, 1700, 1600].map(take);

    it('draws them from the note, in a known order across more than one bucket', async () => {
      expect(samples(await strikes(song))).toEqual(FIRST_PASS);
    });

    it('draws the same takes for a run that starts at beat 3 (a seek)', async () => {
      expect(samples(await strikes(song, { from: 2 }))).toEqual(FIRST_PASS.slice(2));
    });

    it('draws other takes for the same notes on a second pass', async () => {
      const made = samples(await strikes(song, { passes: 2 }));
      expect(made.slice(0, 6)).toEqual(FIRST_PASS);
      expect(made.slice(6)).toEqual(SECOND_PASS);
      expect(SECOND_PASS).not.toEqual(FIRST_PASS);
    });
  });

  it('plays the legato region on a hammer-on and the attack otherwise', async () => {
    const song = score()
      .track('guitar', { tuning: tuning(legato.key) })
      .bar()
      .beat('8', [note(1, 0)])
      .beat('8', [note(1, 0, { hammerPull: true })])
      .build();
    const made = await strikes(song);
    expect(made.map((strike) => strike.sample)).toEqual(legato.tones.map(take));
    // The legato region is the transition itself, so it starts at frame 0, not 20 ms in.
    expect(made[1]?.request.offset).toBeUndefined();
  });

  it('keeps the legato of a hammer-on when a preview of its beat comes in between', async () => {
    const song = score()
      .track('guitar', { tuning: tuning(legato.key) })
      .bar()
      .beat('8', [note(1, 0)])
      .beat('8', [note(1, 0, { hammerPull: true })])
      .build();
    const made = (await strikes(song, { previewAt: 1 })).filter(
      (strike) => strike.request.preview !== true,
    );
    expect(made.map((strike) => strike.sample)).toEqual(legato.tones.map(take));
    expect(made[1]?.request.select?.legato).toBe(true);
  });

  it('strikes a tapped note after a rest with the first-trigger region, not the legato one', async () => {
    const song = score()
      .track('guitar', { tuning: tuning(legato.key) })
      .bar()
      .beat('8', [note(1, 0)])
      .rest('8')
      .beat('8', [note(1, 0)], { effects: { tapping: true } })
      .build();
    const made = await strikes(song);
    expect(made[1]?.request.select?.legato).toBeUndefined();
    expect(made[1]?.request.offset).toBe(ARTICULATION.hammerOffset);
  });

  it('strikes a hammer-on after a rest with the first-trigger region too', async () => {
    const song = score()
      .track('guitar', { tuning: tuning(legato.key) })
      .bar()
      .beat('8', [note(1, 0)])
      .rest('8')
      .beat('8', [note(1, 0, { hammerPull: true })])
      .build();
    const made = await strikes(song);
    expect(made[1]?.request.select?.legato).toBeUndefined();
  });

  it('plays the legato region on a tapped note, with no 20 ms offset', async () => {
    const song = score()
      .track('guitar', { tuning: tuning(legato.key) })
      .bar()
      .beat('8', [note(1, 0)])
      .beat('8', [note(1, 0)], { effects: { tapping: true } })
      .build();
    const made = await strikes(song);
    expect(made.map((strike) => strike.sample)).toEqual(legato.tones.map(take));
    expect(made[1]?.request.select?.legato).toBe(true);
    expect(made[1]?.request.offset).toBeUndefined();
  });

  it('starts a tapped note 20 ms in when no legato region plays', async () => {
    const song = score()
      .track('guitar', { tuning: tuning(velocity.key) })
      .bar()
      .beat('8', [note(1, 0)])
      .beat('8', [note(1, 0)], { effects: { tapping: true } })
      .build();
    const made = await strikes(song);
    expect(made[1]?.request.offset).toBe(ARTICULATION.hammerOffset);
  });

  it('still starts a hammer-on 20 ms in when no legato region plays', async () => {
    const song = score()
      .track('guitar', { tuning: tuning(velocity.key) })
      .bar()
      .beat('8', [note(1, 0)])
      .beat('8', [note(1, 0, { hammerPull: true })])
      .build();
    const made = await strikes(song);
    expect(made[1]?.request.offset).toBe(ARTICULATION.hammerOffset);
  });
});

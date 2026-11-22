import { describe, expect, it } from 'vitest';

import { createSamplerSink } from './sampler-sink';
import { Sampler } from './sampler';
import type { SamplerTrack } from './sampler';
import type { Score, Track } from '@reprise/model';
import { score, note } from '@reprise/model/testing';

import { offline, rms, sineInstrument } from './test/offline';

const CHANNEL = { volume: 127, pan: 64, chorus: 0, reverb: 0, phaser: 0, tremolo: 0 };
/** 3.5 kHz: well above the closed pedal's 400 Hz band, so engaging it is plainly audible. */
const HIGH_KEY = 105;

const track: SamplerTrack = {
  id: 't',
  kind: 'fretted',
  tuning: [],
  capo: 0,
  channel: { ...CHANNEL, mute: false, solo: false },
};

/** A 3.5 kHz sine from 0 on one track, with `script` run before rendering `seconds`. */
async function render(
  seconds: number,
  script?: (sampler: Sampler) => void,
  notes: 'song' | 'preview' = 'song',
): Promise<Float32Array> {
  const context = offline(seconds);
  const sampler = new Sampler(context);
  // A sample three octaves up plays 8 times as fast, so it needs 8 times the length.
  sampler.addTrack(track, sineInstrument(undefined, seconds * 8));
  script?.(sampler);
  if (notes === 'song') sampler.noteOn(track.id, { key: HIGH_KEY, velocity: 100, when: 0 });
  else sampler.previewNote(track.id, { pitch: HIGH_KEY }, { seconds });
  return (await context.startRendering()).getChannelData(0);
}

function expectSame(a: Float32Array, b: Float32Array, from: number, to: number): void {
  let largest = 0;
  for (let i = Math.round(from * 44_100); i < Math.round(to * 44_100); i += 1) {
    largest = Math.max(largest, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  expect(largest).toBeLessThan(1e-6);
}

describe('a strip with a wah pedal', () => {
  it('builds no pedal for an off state it never had', () => {
    const sampler = new Sampler(offline(0.1));
    sampler.addTrack(track, sineInstrument());
    sampler.setWah(track.id, 'off', 0, true);
    expect(sampler.strip(track.id)?.wah).toBeUndefined();
    sampler.setWah(track.id, 'open', 0.1);
    expect(sampler.strip(track.id)?.wah).toBeDefined();
  });

  it('is spliced in silently: the signal is the dry one until the engage lands', async () => {
    const plain = await render(0.8);
    const swept = await render(0.8, (sampler) => {
      sampler.setWah(track.id, 'closed', 0.4);
    });
    expectSame(swept, plain, 0, 0.4);
    // Closed, the pedal leaves a small part of a 3.5 kHz tone, whatever the makeup gain.
    expect(rms(swept, 0.5, 0.8)).toBeLessThan(0.3 * rms(plain, 0.5, 0.8));
  });

  it('gives the dry signal exactly once turned off again', async () => {
    const plain = await render(1);
    const swept = await render(1, (sampler) => {
      sampler.setWah(track.id, 'open', 0.1);
      sampler.setWah(track.id, 'off', 0.4);
    });
    // Open, 3.5 kHz sits off the 2.2 kHz centre: |H| is 0.25, so with the makeup gain of 3.5 the
    // tone keeps about 85% of its level, plainly under the dry one.
    const kept = rms(swept, 0.2, 0.35) / rms(plain, 0.2, 0.35);
    expect(kept).toBeGreaterThan(0.6);
    expect(kept).toBeLessThan(1);
    expectSame(swept, plain, 0.5, 1);
  });

  it('keeps a previewed note dry beside the pedal', async () => {
    const plain = await render(0.5, undefined, 'preview');
    const swept = await render(
      0.5,
      (sampler) => {
        sampler.setWah(track.id, 'closed', 0, true);
      },
      'preview',
    );
    expectSame(swept, plain, 0, 0.5);
  });

  it('drops a change scheduled past cancelAfter', async () => {
    const plain = await render(0.8);
    const cancelled = await render(0.8, (sampler) => {
      sampler.setWah(track.id, 'closed', 0.4);
      sampler.strip(track.id)?.cancelAfter(0.2);
    });
    expectSame(cancelled, plain, 0, 0.8);
  });
});

/** The largest difference between neighbouring samples in `[from, to)`. */
function largestStep(data: Float32Array, from: number, to: number): number {
  let largest = 0;
  for (let i = Math.round(from * 44_100) + 1; i < Math.round(to * 44_100); i += 1) {
    largest = Math.max(largest, Math.abs((data[i] ?? 0) - (data[i - 1] ?? 0)));
  }
  return largest;
}

describe('a restore on a sounding note', () => {
  /** A sustained 440 Hz sine from 0 through the pedal, which `before` sets up and `restore` hits at 0.5 s. */
  async function restored(before: 'open' | 'closed' | 'off', after: 'open' | 'closed' | 'off') {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(track, sineInstrument(undefined, 1));
    sampler.setWah(track.id, before, 0, true);
    sampler.setWah(track.id, after, 0.5, true);
    sampler.noteOn(track.id, { key: 69, velocity: 100, when: 0 });
    return (await context.startRendering()).getChannelData(0);
  }

  // Steps inside the settled sine are the sine's own; a loop wrap restores while the notes at
  // the loop end still ring, and the change must not click on top of them.
  it.each([
    ['open', 'off'],
    ['off', 'open'],
    ['closed', 'open'],
    ['open', 'closed'],
  ] as const)('does not step going from %s to %s', async (before, after) => {
    const data = await restored(before, after);
    // The sine's own steps differ with the state (a closed pedal passes it, an open one cuts it),
    // so the change is held to the larger of the two settled ones. A band-pass whose centre jumps
    // rings a little (2.4 times at worst here); an instant restore stepped 6 to 8 times.
    const settled = Math.max(largestStep(data, 0.3, 0.45), largestStep(data, 0.8, 0.95));
    expect(largestStep(data, 0.5, 0.65)).toBeLessThan(3 * settled);
  });
});

function firstTrack(built: Score): Track {
  const first = built.tracks[0];
  if (!first) throw new Error('fixture');
  return first;
}

describe('the sink', () => {
  const built = score()
    .track('guitar')
    .bar()
    .beat('1', [note(1, 0)])
    .build();
  const guitar = firstTrack(built);

  function wah(state: 'open' | 'closed' | 'off', when: number, restore = false) {
    return {
      track: guitar,
      trackIndex: 0,
      state,
      when,
      playbackTick: 0,
      sequenceIndex: 0,
      masterBarIndex: 0,
      passIndex: 0,
      restore,
    };
  }

  async function rendered(script: (sink: ReturnType<typeof createSamplerSink>) => void) {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(guitar, sineInstrument(undefined, 8));
    const sink = createSamplerSink(sampler);
    script(sink);
    // A note struck after the stop, as the next run's would be.
    sampler.noteOn(guitar.id, { key: HIGH_KEY, velocity: 100, when: 0.5 });
    return (await context.startRendering()).getChannelData(0);
  }

  it('cancels a change already handed out when it stops', async () => {
    const plain = await rendered((sink) => {
      sink.allNotesOff(0.2);
    });
    const cancelled = await rendered((sink) => {
      sink.wah?.(wah('closed', 0.6));
      sink.allNotesOff(0.2);
    });
    expectSame(cancelled, plain, 0.3, 1);
  });

  it('turns a pedal left engaged off when it stops, so an edited-away passage cannot stay wah-filtered', async () => {
    const plain = await rendered((sink) => {
      sink.allNotesOff(0.2);
    });
    const stopped = await rendered((sink) => {
      sink.wah?.(wah('closed', 0, true));
      sink.allNotesOff(0.2);
    });
    expectSame(stopped, plain, 0.3, 1);
  });
});

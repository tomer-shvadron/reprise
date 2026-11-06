import { describe, expect, it } from 'vitest';

import { RegionMap } from './region-map';
import { SynthSampleSource, midiToFrequency } from './sample-source';
import { Sampler } from './sampler';
import type { SamplerTrack } from './sampler';
import {
  SAMPLE_RATE,
  cents,
  offline,
  peak,
  region,
  rms,
  sineInstrument,
  stereoInstrument,
  toneLevel,
  zeroCrossingFrequency,
} from './test/offline';

const CHANNEL = { volume: 127, pan: 64, chorus: 0, reverb: 0, phaser: 0, tremolo: 0 };

function samplerTrack(id: string, channel: Partial<SamplerTrack['channel']> = {}): SamplerTrack {
  return {
    id,
    kind: 'pitched',
    tuning: [],
    capo: 0,
    channel: { ...CHANNEL, mute: false, solo: false, ...channel },
  };
}

async function render(context: OfflineAudioContext): Promise<Float32Array> {
  return (await context.startRendering()).getChannelData(0);
}

describe('detune', () => {
  const cases = [
    { name: 'the root key', key: 69, tune: 0, detune: 0, expected: 440 },
    { name: 'a key shift', key: 76, tune: 0, detune: 0, expected: midiToFrequency(76) },
    { name: 'region tune', key: 64, tune: 7, detune: 0, expected: midiToFrequency(64.07) },
    { name: 'half a semitone', key: 69, tune: 0, detune: 0.5, expected: midiToFrequency(69.5) },
    { name: 'a cent', key: 69, tune: 0, detune: 0.01, expected: midiToFrequency(69.01) },
    {
      name: 'everything at once',
      key: 57,
      tune: -13,
      detune: -1.25,
      expected: midiToFrequency(57 - 0.13 - 1.25),
    },
  ];

  it.each(cases)('lands within a cent for $name', async ({ key, tune, detune, expected }) => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(samplerTrack('t'), {
      ...sineInstrument(),
      regions: new RegionMap([region({ tune })]),
    });
    const voice = sampler.noteOn('t', { key, velocity: 127, when: 0 });
    voice?.setDetune(detune, 0);
    const measured = zeroCrossingFrequency(await render(context), 0.1, 0.9);
    expect(Math.abs(cents(measured, expected))).toBeLessThan(1);
  });

  it('ramps to a bend target and holds it', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(samplerTrack('t'), sineInstrument());
    const voice = sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    voice?.rampDetune(2, 0.2);
    const data = await render(context);
    expect(
      Math.abs(cents(zeroCrossingFrequency(data, 0.3, 0.9), midiToFrequency(71))),
    ).toBeLessThan(1);
  });

  it('plays a looped sample past its end at pitch', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    // 441 Hz is exactly 100 frames a cycle, so a loop of 4,400 frames is seamless.
    sampler.addTrack(samplerTrack('t'), {
      regions: new RegionMap([
        region({ loop: { start: 4400 / SAMPLE_RATE, end: 8800 / SAMPLE_RATE } }),
      ]),
      source: new SynthSampleSource(SAMPLE_RATE, {
        a440: { kind: 'sine', frequency: 441, duration: 0.25 },
      }),
    });
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    const data = await render(context);
    expect(rms(data, 0.5, 0.9)).toBeGreaterThan(0.3);
    expect(Math.abs(cents(zeroCrossingFrequency(data, 0.3, 0.9), 441))).toBeLessThan(1);
  });
});

describe('envelope', () => {
  it('releases to silence after note-off', async () => {
    const release = 0.2;
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(
      samplerTrack('t'),
      sineInstrument({ attack: 0.01, hold: 0, decay: 0.1, sustain: 0.5, release }),
    );
    const voice = sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    if (!voice) throw new Error('no voice');
    sampler.noteOff(voice, 0.4);
    expect(voice.endTime).toBeCloseTo(0.4 + release, 6);
    const data = await render(context);

    expect(rms(data, 0.2, 0.4)).toBeGreaterThan(0.1);
    expect(rms(data, 0.45, 0.5)).toBeLessThan(rms(data, 0.35, 0.4));
    expect(peak(data, 0.4 + release + 0.02, 1)).toBe(0);
  });

  it('decays to the sustain level', async () => {
    const context = offline(1);
    const sampler = new Sampler(context);
    sampler.addTrack(
      samplerTrack('t'),
      sineInstrument({ attack: 0.01, hold: 0.4, decay: 0.1, sustain: 0.25, release: 0.1 }),
    );
    // Quiet enough to stay under the limiter, and measured once its detector has settled.
    sampler.noteOn('t', { key: 69, velocity: 64, when: 0 });
    const data = await render(context);
    const held = toneLevel(data, 440, 0.25, 0.4);
    expect(toneLevel(data, 440, 0.6, 0.95) / held).toBeCloseTo(0.25, 2);
  });

  it('applies the region attenuation', async () => {
    const level = async (attenuation?: number): Promise<number> => {
      const context = offline(0.6);
      const sampler = new Sampler(context);
      sampler.addTrack(samplerTrack('t'), {
        ...sineInstrument(),
        regions: new RegionMap([region(attenuation === undefined ? {} : { attenuation })]),
      });
      sampler.noteOn('t', { key: 69, velocity: 64, when: 0 });
      return toneLevel(await render(context), 440, 0.2, 0.5);
    };
    expect((await level(20 * Math.log10(2))) / (await level())).toBeCloseTo(0.5, 3);
  });
});

describe('voice stealing', () => {
  it('never exceeds the polyphony limit and keeps the newest notes', async () => {
    const context = offline(1);
    const sampler = new Sampler(context, { polyphony: 3 });
    sampler.addTrack(samplerTrack('t'), sineInstrument());
    const keys = [57, 60, 64, 67, 69, 72, 76, 79];
    keys.forEach((key, index) => {
      const when = index * 0.05;
      sampler.noteOn('t', { key, velocity: 100, when });
      expect(sampler.pool.active(when).length).toBeLessThanOrEqual(3);
    });
    expect(sampler.pool.stolen).toBe(keys.length - 3);

    const data = await render(context);
    for (const key of keys.slice(-3)) {
      expect(toneLevel(data, midiToFrequency(key), 0.5, 0.9)).toBeGreaterThan(0.05);
    }
    for (const key of keys.slice(0, -3)) {
      expect(toneLevel(data, midiToFrequency(key), 0.5, 0.9)).toBeLessThan(0.002);
    }
  });

  it('steals a released voice first, then the quietest, then the older of equals', () => {
    const context = offline(1);
    const sampler = new Sampler(context, { polyphony: 3 });
    sampler.addTrack(samplerTrack('t'), sineInstrument({ ...region().envelope, release: 1 }));
    const loudOld = sampler.noteOn('t', { key: 60, velocity: 120, when: 0 });
    const quiet = sampler.noteOn('t', { key: 64, velocity: 40, when: 0.01 });
    const released = sampler.noteOn('t', { key: 67, velocity: 127, when: 0.02 });
    released?.release(0.05);

    sampler.noteOn('t', { key: 72, velocity: 100, when: 0.1 });
    expect(sampler.pool.active(0.1)).not.toContain(released);
    sampler.noteOn('t', { key: 74, velocity: 100, when: 0.2 });
    expect(sampler.pool.active(0.2)).not.toContain(quiet);
    expect(sampler.pool.active(0.2)).toContain(loudOld);
    const newer = sampler.noteOn('t', { key: 76, velocity: 100, when: 0.3 });
    const level = sampler.pool.active(0.3);
    expect(level).toContain(loudOld);
    expect(level).toContain(newer);
    expect(level.map((voice) => voice.key)).not.toContain(72);
    expect(level.length).toBe(3);
  });

  it('fades a stolen released voice from its current level, not its pre-release level', async () => {
    const context = offline(1);
    const sampler = new Sampler(context, { polyphony: 1 });
    sampler.addTrack(
      samplerTrack('t'),
      sineInstrument({ attack: 0.001, hold: 0, decay: 0, sustain: 1, release: 1 }),
    );
    const voice = sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    voice?.release(0.2);
    // Half a second into a one-second release the gain is 1e-4^0.5 = 0.01.
    sampler.noteOn('t', { key: 81, velocity: 1, when: 0.7 });
    expect(sampler.pool.stolen).toBe(1);
    const data = await render(context);
    const before = peak(data, 0.66, 0.699);
    expect(before).toBeGreaterThan(0.005);
    // The master bus delays by about 6 ms, so the window after the steal is wide.
    expect(peak(data, 0.7, 0.73)).toBeLessThan(before * 1.5);
    // Unstolen, the release would still be at 0.006 here; what remains is the velocity-1 note.
    expect(peak(data, 0.75, 1)).toBeLessThan(0.001);
  });

  it('steals a note that has not started yet only when nothing else is left', async () => {
    const context = offline(1);
    const sampler = new Sampler(context, { polyphony: 2 });
    sampler.addTrack(samplerTrack('t'), sineInstrument());
    sampler.noteOn('t', { key: 64, velocity: 127, when: 0 });
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0.5 });
    sampler.noteOn('t', { key: 76, velocity: 127, when: 0.2 });
    expect(sampler.pool.stolen).toBe(1);
    const data = await render(context);
    expect(toneLevel(data, midiToFrequency(76), 0.3, 0.45)).toBeGreaterThan(0.1);
    expect(toneLevel(data, midiToFrequency(64), 0.3, 0.45)).toBeLessThan(0.001);
    expect(toneLevel(data, 440, 0.6, 0.9)).toBeGreaterThan(0.1);

    // With a slot for one, the cap holds: the later note gives way.
    const single = new Sampler(offline(1), { polyphony: 1 });
    single.addTrack(samplerTrack('t'), sineInstrument());
    single.noteOn('t', { key: 69, velocity: 127, when: 0.5 });
    single.noteOn('t', { key: 76, velocity: 127, when: 0.2 });
    expect(single.pool.active(0.2).map((voice) => voice.key)).toEqual([76]);
  });
});

describe('let ring', () => {
  const A = 69;
  const E = 76;

  async function play(setup: (sampler: Sampler) => void): Promise<Float32Array> {
    const context = offline(1.2);
    const sampler = new Sampler(context);
    sampler.addTrack(samplerTrack('t'), sineInstrument());
    setup(sampler);
    return render(context);
  }

  it('releases an ordinary note at note-off', async () => {
    const data = await play((sampler) => {
      const voice = sampler.noteOn('t', { key: A, velocity: 127, when: 0, string: 1 });
      if (voice) sampler.noteOff(voice, 0.2);
    });
    expect(toneLevel(data, 440, 0.4, 0.6)).toBeLessThan(0.001);
  });

  it('defers note-off to the next note on the same string', async () => {
    const data = await play((sampler) => {
      const ringing = sampler.noteOn('t', {
        key: A,
        velocity: 127,
        when: 0,
        string: 1,
        letRing: true,
      });
      if (ringing) sampler.noteOff(ringing, 0.2);
      const other = sampler.noteOn('t', { key: E, velocity: 127, when: 0.3, string: 2 });
      if (other) sampler.noteOff(other, 0.5);
      sampler.noteOn('t', { key: E, velocity: 127, when: 0.7, string: 1 });
    });
    expect(toneLevel(data, 440, 0.4, 0.65)).toBeGreaterThan(0.2);
    expect(toneLevel(data, 440, 0.8, 1.1)).toBeLessThan(0.001);
  });

  it('defers note-off to a given time', async () => {
    const data = await play((sampler) => {
      const voice = sampler.noteOn('t', {
        key: A,
        velocity: 127,
        when: 0,
        string: 1,
        letRing: { until: 0.6 },
      });
      if (voice) sampler.noteOff(voice, 0.1);
    });
    expect(toneLevel(data, 440, 0.3, 0.55)).toBeGreaterThan(0.2);
    expect(toneLevel(data, 440, 0.7, 1.1)).toBeLessThan(0.001);
  });
});

describe('mixer', () => {
  const A = 440;
  const E = midiToFrequency(76);

  async function levels(
    a: Partial<SamplerTrack['channel']>,
    b: Partial<SamplerTrack['channel']>,
  ): Promise<[number, number]> {
    const context = offline(0.6);
    const sampler = new Sampler(context);
    sampler.addTrack(samplerTrack('a', a), sineInstrument());
    sampler.addTrack(samplerTrack('b', b), sineInstrument());
    sampler.noteOn('a', { key: 69, velocity: 127, when: 0 });
    sampler.noteOn('b', { key: 76, velocity: 127, when: 0 });
    const data = await render(context);
    return [toneLevel(data, A, 0.1, 0.5), toneLevel(data, E, 0.1, 0.5)];
  }

  const audible = (level: number) => level > 0.1;

  it.each([
    { name: 'both play', a: {}, b: {}, expected: [true, true] },
    { name: 'mute silences a strip', a: { mute: true }, b: {}, expected: [false, true] },
    { name: 'solo silences the others', a: {}, b: { solo: true }, expected: [false, true] },
    {
      name: 'solos add up',
      a: { solo: true },
      b: { solo: true },
      expected: [true, true],
    },
    {
      name: 'mute beats solo',
      a: { solo: true, mute: true },
      b: {},
      expected: [false, false],
    },
  ])('$name', async ({ a, b, expected }) => {
    expect((await levels(a, b)).map(audible)).toEqual(expected);
  });

  it('follows setTrack after the strips are built', async () => {
    const context = offline(0.6);
    const sampler = new Sampler(context);
    sampler.addTrack(samplerTrack('a'), sineInstrument());
    sampler.addTrack(samplerTrack('b'), sineInstrument());
    sampler.setTrack('a', { solo: true });
    sampler.setTrack('a', { volume: 64, pan: 0 });
    expect(sampler.strip('a')?.pan).toBe(-1);
    expect(sampler.strip('a')?.gain).toBeCloseTo((64 / 127) ** 2, 6);
    sampler.noteOn('a', { key: 69, velocity: 127, when: 0 });
    sampler.noteOn('b', { key: 76, velocity: 127, when: 0 });
    const output = await context.startRendering();
    const left = output.getChannelData(0);
    const right = output.getChannelData(1);
    expect(toneLevel(left, E, 0.1, 0.5)).toBeLessThan(0.001);
    expect(toneLevel(left, A, 0.1, 0.5)).toBeGreaterThan(0.1);
    expect(peak(right, 0.1, 0.5)).toBeLessThan(0.001);
  });

  it('plays a stereo sample on both channels', async () => {
    const context = offline(0.6);
    const sampler = new Sampler(context);
    sampler.addTrack(samplerTrack('t'), stereoInstrument(440, 660));
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    const output = await context.startRendering();
    const left = output.getChannelData(0);
    const right = output.getChannelData(1);
    expect(toneLevel(left, 440, 0.2, 0.5)).toBeGreaterThan(0.4);
    expect(toneLevel(right, 660, 0.2, 0.5)).toBeGreaterThan(0.4);
    expect(toneLevel(left, 660, 0.2, 0.5)).toBeLessThan(0.001);
    expect(toneLevel(right, 440, 0.2, 0.5)).toBeLessThan(0.001);
  });

  it('pans a mono region', async () => {
    const context = offline(0.6);
    const sampler = new Sampler(context);
    sampler.addTrack(samplerTrack('t'), {
      ...sineInstrument(),
      regions: new RegionMap([region({ pan: -1 })]),
    });
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    const output = await context.startRendering();
    expect(toneLevel(output.getChannelData(0), A, 0.2, 0.5)).toBeGreaterThan(0.1);
    expect(peak(output.getChannelData(1), 0.2, 0.5)).toBeLessThan(0.001);
  });

  it('passes through the empty effects insertion point', () => {
    const context = offline(0.1);
    const sampler = new Sampler(context);
    const strip = sampler.addTrack(samplerTrack('a'), sineInstrument());
    expect(strip.insert.input).toBeInstanceOf(GainNode);
    expect(strip.insert.output).toBeInstanceOf(GainNode);
  });

  it('limits the master bus', async () => {
    const context = offline(0.6);
    const sampler = new Sampler(context);
    expect(sampler.master.limiter).toBeInstanceOf(DynamicsCompressorNode);
    expect(sampler.master.limiter.ratio.value).toBeGreaterThanOrEqual(20);
    sampler.addTrack(samplerTrack('a'), sineInstrument());
    for (let index = 0; index < 8; index += 1) {
      sampler.noteOn('a', { key: 69, velocity: 127, when: 0 });
    }
    // Eight in-phase sines at -3 dB per side would peak near 5.7 unlimited.
    expect(peak(await render(context), 0.2, 0.6)).toBeLessThan(1.2);
  });
});

describe('load', () => {
  it(
    'starts every note of a burst, holds the limit, and frees every voice',
    { timeout: 120_000 },
    async () => {
      const notes = 2000;
      const spacing = 0.002;
      const length = 0.25;
      const polyphony = 64;
      const context = offline(notes * spacing + 0.5);
      const sampler = new Sampler(context, { polyphony });
      sampler.addTrack(samplerTrack('t'), sineInstrument());

      const started = performance.now();
      for (let index = 0; index < notes; index += 1) {
        const when = index * spacing;
        const voice = sampler.noteOn('t', { key: 40 + (index % 48), velocity: 100, when });
        if (!voice) throw new Error(`note ${String(index)} did not start`);
        sampler.noteOff(voice, when + length);
        expect(sampler.pool.active(when).length).toBeLessThanOrEqual(polyphony);
      }
      const elapsed = performance.now() - started;

      // Every voice outlives the next 64 onsets, so each note past the limit steals exactly one.
      expect(sampler.pool.stolen).toBe(notes - polyphony);
      // Measured at about 30 us per note; the bound only catches a pathological regression.
      expect(elapsed / notes).toBeLessThan(1);

      await context.startRendering();
      expect(sampler.pool.active(0)).toHaveLength(0);
    },
  );
});

describe('sample residency', () => {
  it('skips a note whose sample is not resident and loads it for next time', async () => {
    const context = offline(0.5);
    const misses: string[] = [];
    const sampler = new Sampler(context, { onMiss: (_track, sample) => misses.push(sample) });
    const source = new SynthSampleSource(
      SAMPLE_RATE,
      { a440: { kind: 'sine', frequency: 440, duration: 1 } },
      { deferred: true },
    );
    sampler.addTrack(samplerTrack('t'), { regions: new RegionMap([region()]), source });

    expect(sampler.noteOn('t', { key: 69, velocity: 100, when: 0 })).toBeUndefined();
    expect(misses).toEqual(['a440']);
    await sampler.preload('t', [{ key: 69, velocity: 100 }]);
    expect(sampler.noteOn('t', { key: 69, velocity: 100, when: 0 })).toBeDefined();
    expect(sampler.misses).toBe(1);
    expect(rms(await render(context), 0.1, 0.4)).toBeGreaterThan(0.1);
  });
});

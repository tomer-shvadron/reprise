import { describe, expect, it } from 'vitest';

import { RegionMap } from './region-map';
import type { Region } from './region-map';
import { SynthSampleSource } from './sample-source';
import type { SynthSample } from './sample-source';
import { Sampler } from './sampler';
import type { Instrument, SamplerTrack } from './sampler';
import { ORGAN, SAMPLE_RATE, offline, peak, region, rms, toneLevel } from './test/offline';

const TRACK: SamplerTrack = {
  id: 't',
  kind: 'pitched',
  tuning: [],
  capo: 0,
  channel: {
    volume: 127,
    pan: 64,
    chorus: 0,
    reverb: 0,
    phaser: 0,
    tremolo: 0,
    mute: false,
    solo: false,
  },
};

const sine = (frequency: number): SynthSample => ({ kind: 'sine', frequency, duration: 3 });

function instrument(
  regions: Region[],
  samples: Record<string, SynthSample>,
  options: { deferred?: boolean } = {},
): Instrument {
  return {
    regions: new RegionMap(regions),
    source: new SynthSampleSource(SAMPLE_RATE, samples, options),
  };
}

/** A sampler with one track whose master bus is bypassed: no limiter, no pre-delay. */
function setup(
  seconds: number,
  voices?: number,
): { context: OfflineAudioContext; sampler: Sampler } {
  const context = offline(seconds);
  const sampler = new Sampler(context, voices === undefined ? {} : { polyphony: voices });
  sampler.master.input.disconnect();
  sampler.master.input.connect(context.destination);
  return { context, sampler };
}

async function render(context: OfflineAudioContext): Promise<Float32Array> {
  return (await context.startRendering()).getChannelData(0);
}

describe('layered regions', () => {
  const layered = (): Instrument =>
    instrument([region({ sample: 'body' }), region({ sample: 'air', attenuation: 6 })], {
      body: sine(440),
      air: sine(1320),
    });

  it('resolves every matching region, and one nearest region outside the map', () => {
    const map = layered().regions;
    expect(map.resolveAll(69, 100).map((r) => r.sample)).toEqual(['body', 'air']);
    expect(map.resolve(69, 100)?.sample).toBe('body');
    const narrow = new RegionMap([
      region({ keyLo: 60, keyHi: 64 }),
      region({ keyLo: 62, keyHi: 70 }),
    ]);
    expect(narrow.resolveAll(50, 100)).toHaveLength(1);
    expect(new RegionMap([]).resolveAll(60, 100)).toEqual([]);
  });

  it('starts a voice per region behind one handle, which automation and release reach', async () => {
    const { context, sampler } = setup(1);
    sampler.addTrack(TRACK, layered());
    const handle = sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    expect(sampler.pool.active(0)).toHaveLength(2);
    handle?.setGain(-6, 0.3);
    handle?.release(0.5);
    expect(handle?.endTime).toBeCloseTo(0.5 + ORGAN.release, 9);
    const data = await render(context);

    const body = toneLevel(data, 440, 0.1, 0.25);
    const air = toneLevel(data, 1320, 0.1, 0.25);
    expect(body).toBeGreaterThan(0.5);
    expect(air / body).toBeCloseTo(10 ** (-6 / 20), 2);
    expect(toneLevel(data, 1320, 0.32, 0.48) / air).toBeCloseTo(10 ** (-6 / 20), 2);
    expect(peak(data, 0.6, 1)).toBe(0);
  });

  it('fans detune, a detune curve, a filter and let-ring out to every layer', async () => {
    const { context, sampler } = setup(1.2);
    sampler.addTrack(TRACK, layered());
    const handle = sampler.noteOn('t', { key: 69, velocity: 127, when: 0, letRing: true });
    expect(handle?.letRing).toBe(true);
    handle?.setDetune(12, 0.2);
    handle?.detuneCurve([-12, -12], 0.45, 0.1);
    if (handle) sampler.noteOff(handle, 0.3);
    handle?.setFilter({ type: 'lowpass', frequency: 300 }, 0.8);
    handle?.release(1.1);
    const data = await render(context);

    expect(toneLevel(data, 880, 0.25, 0.4)).toBeGreaterThan(0.5);
    expect(toneLevel(data, 2640, 0.25, 0.4)).toBeGreaterThan(0.2);
    expect(toneLevel(data, 1320, 0.25, 0.4)).toBeLessThan(0.001);
    // The curve holds its last value, and the note-off at 0.3 s passed a let-ring note by.
    const body = toneLevel(data, 220, 0.6, 0.75);
    const air = toneLevel(data, 660, 0.6, 0.75);
    expect(body).toBeGreaterThan(0.5);
    expect(air).toBeGreaterThan(0.2);
    const filtered = toneLevel(data, 660, 0.85, 1) / toneLevel(data, 220, 0.85, 1);
    expect(filtered).toBeLessThan((air / body) * 0.4);
  });

  it('plays no note when no layer is resident, and counts each missing sample', () => {
    const misses: string[] = [];
    const sampler = new Sampler(offline(0.5), { onMiss: (_track, sample) => misses.push(sample) });
    const source = new SynthSampleSource(
      SAMPLE_RATE,
      { x: sine(440), y: sine(660), z: sine(880) },
      { deferred: true },
    );
    const regions = new RegionMap(['x', 'y', 'z'].map((sample) => region({ sample })));
    sampler.addTrack(TRACK, { regions, source });
    expect(sampler.noteOn('t', { key: 69, velocity: 100, when: 0 })).toBeUndefined();
    expect(misses).toEqual(['x', 'y', 'z']);
    expect(sampler.misses).toBe(3);
  });

  it('plays the resident layers when one is missing, and reports the missing one', async () => {
    const misses: string[] = [];
    const context = offline(0.5);
    const sampler = new Sampler(context, { onMiss: (_track, sample) => misses.push(sample) });
    const source = new SynthSampleSource(
      SAMPLE_RATE,
      { body: sine(440), air: sine(1320) },
      { deferred: true },
    );
    sampler.addTrack(TRACK, { regions: layered().regions, source });
    await source.getBuffer('body');
    expect(sampler.noteOn('t', { key: 69, velocity: 100, when: 0 })).toBeDefined();
    expect(misses).toEqual(['air']);
    expect(sampler.pool.active(0)).toHaveLength(1);
  });

  it('preloads every layer', async () => {
    const context = offline(0.5);
    const sampler = new Sampler(context);
    const source = new SynthSampleSource(
      SAMPLE_RATE,
      { body: sine(440), air: sine(1320) },
      { deferred: true },
    );
    sampler.addTrack(TRACK, { regions: layered().regions, source });
    await sampler.preload('t', [{ key: 69, velocity: 100 }]);
    expect(source.peekBuffer('body')).toBeDefined();
    expect(source.peekBuffer('air')).toBeDefined();
  });
});

describe('region filter', () => {
  const tone = (filter?: Region['filter']): Instrument =>
    instrument([region({ sample: 'high', ...(filter && { filter }) })], { high: sine(4000) });

  async function level(filter: Region['filter'], articulate = false): Promise<number> {
    const { context, sampler } = setup(0.6);
    sampler.addTrack(TRACK, tone(filter));
    const voice = sampler.noteOn('t', { key: 69, velocity: 100, when: 0 });
    if (articulate) voice?.setFilter({ type: 'highshelf', frequency: 2000, gain: 6 }, 0);
    return toneLevel(await render(context), 4000, 0.2, 0.5);
  }

  it('low-passes the voice from its start, at the region cutoff and resonance', async () => {
    const open = await level(undefined);
    // A Butterworth low-pass at 500 Hz is down 12 dB per octave: three octaves, about -36 dB.
    const butterworth = (await level({ cutoffHz: 500, q: -3.0103 })) / open;
    expect(20 * Math.log10(butterworth)).toBeCloseTo(-36.1, 0);
    // At the cutoff, the resonance is the gain: +6 dB of Q is 6 dB above the Butterworth's -3.
    const atCutoff = async (q: number): Promise<number> => {
      const { context, sampler } = setup(0.6);
      sampler.addTrack(
        TRACK,
        instrument([region({ sample: 's', filter: { cutoffHz: 1000, q } })], { s: sine(1000) }),
      );
      sampler.noteOn('t', { key: 69, velocity: 100, when: 0 });
      return toneLevel(await render(context), 1000, 0.2, 0.5);
    };
    expect(20 * Math.log10((await atCutoff(6)) / (await atCutoff(-3.0103)))).toBeCloseTo(9, 0);
  });

  it('keeps the region low-pass under an articulation that switches the filter type', async () => {
    const filtered = await level({ cutoffHz: 500, q: -3.0103 });
    const shelved = await level({ cutoffHz: 500, q: -3.0103 }, true);
    // The harmonic's +6 dB shelf adds to the low-pass instead of replacing it.
    expect(20 * Math.log10(shelved / filtered)).toBeCloseTo(6, 0);
  });
});

describe('region filter envelope and modulators', () => {
  const BUTTERWORTH = -3.0103;
  const NONE = { input: 'none', curve: 'linear', negative: false, bipolar: false } as const;

  /** A 4 kHz tone under `region`, with its level in dB over `[from, to]` against the open tone. */
  async function levelDb(
    spec: Partial<Region>,
    span: readonly [number, number],
    velocity = 127,
    key = 69,
  ): Promise<number> {
    const play = async (extra: Partial<Region>): Promise<number> => {
      const { context, sampler } = setup(1);
      sampler.addTrack(
        TRACK,
        instrument([region({ sample: 'high', ...extra })], { high: sine(4000) }),
      );
      sampler.noteOn('t', { key, velocity, when: 0 });
      return toneLevel(await render(context), 4000, ...span);
    };
    return 20 * Math.log10((await play(spec)) / (await play({})));
  }

  const sweep = (sustain: number): Partial<Region> => ({
    filter: {
      cutoffHz: 500,
      q: BUTTERWORTH,
      // 4800 cents is four octaves: 500 Hz opens to 8 kHz, above the 4 kHz tone.
      envelope: { cents: 4800, delay: 0, attack: 0.001, hold: 0, decay: 0.2, sustain },
    },
  });

  it('opens the cutoff at the attack and lets it fall back to its rest', async () => {
    // Early, the 8 kHz low-pass passes the 4 kHz tone within a few dB; late, 500 Hz is -36 dB.
    expect(await levelDb(sweep(0), [0.01, 0.04])).toBeGreaterThan(-4);
    expect(await levelDb(sweep(0), [0.5, 0.9])).toBeCloseTo(-36.1, 0);
  });

  it('settles at the sustain share of the depth', async () => {
    // Half of four octaves is two: 2 kHz, so the 4 kHz tone is one octave over it, about -12 dB.
    expect(await levelDb(sweep(0.5), [0.5, 0.9])).toBeCloseTo(-12.3, 0);
  });

  it('holds the cutoff at the peak for the hold time before the fall', async () => {
    const held = sweep(0);
    if (held.filter?.envelope) held.filter.envelope.hold = 0.3;
    expect(await levelDb(held, [0.2, 0.28])).toBeGreaterThan(-4);
    expect(await levelDb(held, [0.8, 0.95])).toBeLessThan(-30);
  });

  describe('key-scaled hold and decay of the filter envelope', () => {
    const keyed = (
      envelope: Partial<NonNullable<NonNullable<Region['filter']>['envelope']>>,
      range = { keyLo: 0, keyHi: 127 },
    ): Partial<Region> => ({
      ...range,
      filter: {
        cutoffHz: 500,
        q: BUTTERWORTH,
        envelope: {
          cents: 4800,
          delay: 0,
          attack: 0.001,
          hold: 0,
          decay: 0.2,
          sustain: 0,
          ...envelope,
        },
      },
    });

    it('holds the cutoff open longer for a lower key', async () => {
      // 100 timecents per key below 60: hold 0.3 s at key 60, 0.6 s at key 48, then a 0.2 s fall.
      const spec = keyed({ hold: 0.3, holdPerKey: 100 });
      expect(await levelDb(spec, [0.52, 0.58], 127, 48)).toBeGreaterThan(-4);
      expect(await levelDb(spec, [0.55, 0.65], 127, 60)).toBeLessThan(-20);
    });

    it("scales the hold by the region's edge key for a strike outside its range", async () => {
      const spec = keyed({ hold: 0.3, holdPerKey: 100 }, { keyLo: 48, keyHi: 60 });
      // Key 72 plays with key 60's 0.3 s hold, key 36 with key 48's 0.6 s.
      expect(await levelDb(spec, [0.55, 0.65], 127, 72)).toBeLessThan(-20);
      expect(await levelDb(spec, [0.52, 0.58], 127, 36)).toBeGreaterThan(-4);
    });

    it('stretches the fall for a lower key', async () => {
      // Decay 0.2 s at key 60 and 0.8 s at key 36 (100 timecents per key): still closing at 0.5 s.
      const spec = keyed({ decayPerKey: 100 });
      // The notes differ in pitch too, so the closed one is the reference, not a fixed level.
      const closed = await levelDb(spec, [0.5, 0.55], 127, 60);
      expect(closed).toBeLessThan(-20);
      expect(await levelDb(spec, [0.5, 0.55], 127, 36)).toBeGreaterThan(closed + 6);
    });
  });

  it('plays the velocity curve from the modulators, and none when they leave it out', async () => {
    const attenuation = (amount: number) => ({
      destination: 'attenuation' as const,
      amount,
      source: NONE,
      amountSource: NONE,
      absolute: false,
    });
    // Levels are against the same note without modulators, which plays the MIDI velocity curve:
    // velocity 64 is (64 / 127)^2, about -11.9 dB.
    const curve = -20 * Math.log10((127 / 64) ** 2);
    // With modulators the curve is theirs: none at all here, so the note is 11.9 dB louder.
    expect(await levelDb({ modulators: [] }, [0.2, 0.5], 64)).toBeCloseTo(-curve, 1);
    // A constant 60 cB modulator is 6 dB down from that.
    expect(await levelDb({ modulators: [attenuation(60)] }, [0.2, 0.5], 64)).toBeCloseTo(
      -curve - 6.02,
      1,
    );
  });

  it('stays dark for the envelope delay, then opens', async () => {
    const delayed = sweep(0);
    if (delayed.filter?.envelope) delayed.filter.envelope.delay = 0.2;
    expect(await levelDb(delayed, [0.05, 0.15])).toBeLessThan(-30);
    expect(await levelDb(delayed, [0.21, 0.24])).toBeGreaterThan(-6);
  });

  it('creates the region low-pass only for a note that can close it', () => {
    const countFilters = (extra: Partial<Region>): number => {
      const { context, sampler } = setup(0.2);
      const create = context.createBiquadFilter.bind(context);
      let created = 0;
      context.createBiquadFilter = () => {
        created += 1;
        return create();
      };
      sampler.addTrack(
        TRACK,
        instrument([region({ sample: 'high', ...extra })], { high: sine(4000) }),
      );
      return sampler.noteOn('t', { key: 69, velocity: 100, when: 0 }) ? created : -1;
    };
    // Whatever the voice and strip create anyway, with no region filter at all.
    const baseline = countFilters({});
    // initialFilterFc's maximum, 13500 cents.
    const openHz = 440 * 2 ** 5.5;
    const open = { filter: { cutoffHz: openHz, q: BUTTERWORTH }, modulators: [] };
    expect(countFilters(open)).toBe(baseline);
    expect(countFilters({ filter: { cutoffHz: 2000, q: BUTTERWORTH }, modulators: [] })).toBe(
      baseline + 1,
    );
    expect(countFilters({ filter: { cutoffHz: openHz, q: 6 }, modulators: [] })).toBe(baseline + 1);
  });

  it('moves the cutoff with a note-on modulator', async () => {
    const closing = {
      filter: { cutoffHz: 19_900, q: BUTTERWORTH },
      modulators: [
        {
          destination: 'filterFc' as const,
          amount: -6000,
          source: NONE,
          amountSource: NONE,
          absolute: false,
        },
      ],
    };
    // 13500 - 6000 cents is 622 Hz; the 4 kHz tone sits 2.7 octaves above it.
    const level = await levelDb(closing, [0.2, 0.5]);
    expect(level).toBeLessThan(-29);
    expect(level).toBeGreaterThan(-35);
  });
});

describe('envelope delay', () => {
  it('holds the voice silent for the delay while the sample runs, then attacks', async () => {
    const { context, sampler } = setup(1);
    const envelope = { ...ORGAN, delay: 0.2 };
    sampler.addTrack(TRACK, instrument([region({ envelope })], { a440: sine(440) }));
    const voice = sampler.noteOn('t', { key: 69, velocity: 127, when: 0.1 });
    // It plays nothing yet, but the pool ranks it by the level it is about to sound at.
    const [delayed] = sampler.pool.active(0.2);
    expect(delayed?.levelAt(0.2)).toBe(0);
    expect(delayed?.stealLevelAt(0.2)).toBeGreaterThan(0.5);
    voice?.release(0.8);
    const data = await render(context);
    expect(peak(data, 0, 0.3)).toBe(0);
    expect(rms(data, 0.31, 0.32)).toBeGreaterThan(0);
    expect(rms(data, 0.35, 0.75)).toBeGreaterThan(0.3);
  });
});

describe('exclusive class', () => {
  const kit = (): Instrument =>
    instrument(
      [
        region({ keyLo: 42, keyHi: 42, rootKey: 42, sample: 'closed', exclusiveClass: 1 }),
        region({ keyLo: 46, keyHi: 46, rootKey: 46, sample: 'open', exclusiveClass: 1 }),
        region({ keyLo: 49, keyHi: 49, rootKey: 49, sample: 'crash' }),
      ],
      { closed: sine(3000), open: sine(5000), crash: sine(700) },
    );

  it('chokes a sounding voice of the same class within the instrument, and nothing else', async () => {
    const { context, sampler } = setup(1);
    const drums = kit();
    sampler.addTrack(TRACK, drums);
    sampler.noteOn('t', { key: 46, velocity: 127, when: 0 });
    sampler.noteOn('t', { key: 49, velocity: 127, when: 0 });
    // The same class in another instrument (the dead-note path) does not choke the kit.
    sampler.noteOn('t', { key: 42, velocity: 127, when: 0.2, instrument: kit() });
    sampler.noteOn('t', { key: 42, velocity: 127, when: 0.4 });
    const data = await render(context);

    expect(toneLevel(data, 5000, 0.25, 0.39)).toBeGreaterThan(0.5);
    expect(toneLevel(data, 5000, 0.42, 0.9)).toBeLessThan(0.001);
    expect(toneLevel(data, 700, 0.42, 0.9)).toBeGreaterThan(0.5);
    expect(toneLevel(data, 3000, 0.42, 0.9)).toBeGreaterThan(0.5);
  });

  it('chokes within one track only when two tracks share a kit', async () => {
    const { context, sampler } = setup(1);
    const drums = kit();
    sampler.addTrack(TRACK, drums);
    sampler.addTrack({ ...TRACK, id: 'u' }, drums);
    sampler.noteOn('t', { key: 46, velocity: 127, when: 0 });
    sampler.noteOn('u', { key: 42, velocity: 127, when: 0.2 });
    sampler.noteOn('t', { key: 42, velocity: 127, when: 0.5 });
    const data = await render(context);

    expect(toneLevel(data, 5000, 0.25, 0.45)).toBeGreaterThan(0.5);
    expect(toneLevel(data, 5000, 0.52, 0.9)).toBeLessThan(0.001);
  });
});

describe('stealing by audible level', () => {
  it('ranks a voice by its articulation gain as well as its velocity and envelope', () => {
    const { sampler } = setup(1, 2);
    sampler.addTrack(TRACK, instrument([region()], { a440: sine(440) }));
    // Velocity 127 palm-muted to -18 dB, and a fade-in at -48 dB rising: both quieter than a
    // plain velocity-90 note, which is what a ranking by velocity and envelope alone keeps.
    const muted = sampler.noteOn('t', { key: 60, velocity: 127, when: 0 });
    muted?.setGain(0, 0);
    muted?.rampGain(-18, 0.25);
    const plain = sampler.noteOn('t', { key: 64, velocity: 90, when: 0.01 });
    sampler.noteOn('t', { key: 67, velocity: 100, when: 0.3 });
    expect(sampler.pool.active(0.3)).toContain(plain);
    expect(sampler.pool.active(0.3)).not.toContain(muted);

    const fading = sampler.noteOn('t', { key: 72, velocity: 127, when: 0.4 });
    fading?.setGain(-48, 0.4);
    fading?.rampGain(0, 2.4);
    sampler.noteOn('t', { key: 74, velocity: 100, when: 0.5 });
    expect(sampler.pool.active(0.5)).not.toContain(fading);
  });

  it('steals a started voice before one starting with the new note, such as its own layer', () => {
    const { sampler } = setup(1, 2);
    sampler.addTrack(
      TRACK,
      instrument([region({ sample: 'a' }), region({ sample: 'b' })], {
        a: sine(440),
        b: sine(880),
      }),
    );
    sampler.noteOn('t', { key: 60, velocity: 100, when: 0 });
    sampler.noteOn('t', { key: 64, velocity: 100, when: 0.1 });
    expect(sampler.pool.stolen).toBe(2);
    expect(sampler.pool.active(0.1).map((voice) => voice.key)).toEqual([64, 64]);
  });

  it('keeps a layer inside its envelope delay over a quieter sounding note', () => {
    const { sampler } = setup(1, 3);
    sampler.addTrack(
      TRACK,
      instrument(
        [region({ sample: 'a' }), region({ sample: 'b', envelope: { ...ORGAN, delay: 0.15 } })],
        { a: sine(440), b: sine(880) },
      ),
    );
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0 });
    const single = instrument([region()], { a440: sine(440) });
    sampler.noteOn('t', { key: 60, velocity: 30, when: 0.05, instrument: single });
    sampler.noteOn('t', { key: 67, velocity: 30, when: 0.1, instrument: single });
    expect(sampler.pool.active(0.1).map((voice) => voice.key)).toEqual([69, 69, 67]);
  });

  it('holds the polyphony for a chord, stealing its quietest partner when nothing else is left', () => {
    const { sampler } = setup(1, 2);
    sampler.addTrack(TRACK, instrument([region()], { a440: sine(440) }));
    sampler.noteOn('t', { key: 60, velocity: 100, when: 0 });
    sampler.noteOn('t', { key: 64, velocity: 40, when: 0 });
    sampler.noteOn('t', { key: 67, velocity: 80, when: 0 });
    expect(sampler.pool.active(0)).toHaveLength(2);
    expect(sampler.pool.stolen).toBe(1);
    expect(sampler.pool.active(0).map((voice) => voice.key)).toEqual([60, 67]);
  });
});

describe('scheduled instrument changes', () => {
  it('switches the instrument at its time; a note before it keeps the old one', async () => {
    const { context, sampler } = setup(1.2);
    const first = instrument([region()], { a440: sine(440) });
    const second = instrument([region({ sample: 'other' })], { other: sine(660) });
    sampler.addTrack(TRACK, first);
    sampler.setInstrument('t', second, 0.5);
    expect(sampler.instrumentAt('t', 0.49)).toBe(first);
    expect(sampler.instrumentAt('t', 0.5)).toBe(second);
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0.1 })?.release(0.4);
    sampler.noteOn('t', { key: 69, velocity: 127, when: 0.6 })?.release(1);
    const data = await render(context);
    expect(toneLevel(data, 440, 0.15, 0.35)).toBeGreaterThan(0.5);
    expect(toneLevel(data, 660, 0.15, 0.35)).toBeLessThan(0.001);
    expect(toneLevel(data, 660, 0.65, 0.95)).toBeGreaterThan(0.5);
    expect(toneLevel(data, 440, 0.65, 0.95)).toBeLessThan(0.001);
  });

  it('replaces scheduled changes when switched now', () => {
    const { sampler } = setup(1);
    const first = instrument([region()], { a440: sine(440) });
    const second = instrument([region()], { a440: sine(660) });
    sampler.addTrack(TRACK, first);
    sampler.setInstrument('t', second, 0.5);
    sampler.setInstrument('t', first);
    expect(sampler.instrumentAt('t', 0.9)).toBe(first);
  });

  it('drops the changes scheduled after an all-notes-off, and keeps the ones before it', () => {
    const { sampler } = setup(1);
    const first = instrument([region()], { a440: sine(440) });
    const second = instrument([region()], { a440: sine(660) });
    const third = instrument([region()], { a440: sine(880) });
    sampler.addTrack(TRACK, first);
    sampler.setInstrument('t', second, 0.2);
    sampler.setInstrument('t', third, 0.5);
    sampler.allNotesOff(0.3);
    expect(sampler.instrumentAt('t', 0.9)).toBe(second);
  });
});

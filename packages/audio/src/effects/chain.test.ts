import { describe, expect, it } from 'vitest';

import { ChannelStrip } from '../sampler/channel-strip';
import { EFFECT_PRESET_IDS, EFFECT_STAGES, stagesOf } from './presets';
import type { EffectPresetId, EffectSpec } from './presets';
import { ImpulseBank } from './reverb-bus';
import {
  ManualDefer,
  SAMPLE_RATE,
  bandEnergy,
  context,
  decibels,
  maxStep,
  peak,
  play,
  pluckedLine,
  render,
  rig,
  rms,
  sineBuffer,
  thd,
  toneLevel,
} from './test/measure';

const FREQUENCY = 220;
/** An integer number of cycles: 110 of them. */
const [FROM, TO] = [0.25, 0.75] as const;

async function through(preset: EffectPresetId | undefined): Promise<Float32Array> {
  const { ctx, manual, strip } = rig(1);
  strip.setEffects(stagesOf(preset));
  // -12 dBFS.
  play(ctx, sineBuffer(ctx, FREQUENCY, 0.25), strip.input);
  return (await render(ctx, manual)).getChannelData(0);
}

describe('harmonics', () => {
  // Thresholds from measured values (44.1 kHz, a 220 Hz sine at -12 dBFS, harmonics 2 to 8 by
  // Goertzel over 0.25 to 0.75 s): distortion 0.31, fuzz 0.43, overdrive 0.15, clean 0.010, and
  // bypassed under 1e-6; the 2f / f ratio is 0.016 for fuzz and under 2e-4 for the others.
  it('the distortion preset adds harmonics: THD at least 0.2 and 20x the bypassed signal', async () => {
    const [bypassed, distortion] = await Promise.all([through('off'), through('distortion')]);
    const base = thd(bypassed, FREQUENCY, FROM, TO);
    const driven = thd(distortion, FREQUENCY, FROM, TO);
    expect(driven).toBeGreaterThanOrEqual(0.2);
    expect(driven).toBeGreaterThanOrEqual(20 * base);
  });

  it('puts energy above the fundamental, at least 20 dB over bypass', async () => {
    const ratio = (data: Float32Array): number =>
      decibels(bandEnergy(data, 600, 4000, FROM, TO) / bandEnergy(data, 150, 300, FROM, TO));
    const [bypassed, distortion] = await Promise.all([through('off'), through('distortion')]);
    expect(ratio(distortion) - ratio(bypassed)).toBeGreaterThanOrEqual(20);
  });

  it('keeps the clean preset clean, and only fuzz makes even harmonics', async () => {
    const second = (data: Float32Array): number =>
      toneLevel(data, 2 * FREQUENCY, FROM, TO) / toneLevel(data, FREQUENCY, FROM, TO);
    expect(thd(await through('clean'), FREQUENCY, FROM, TO)).toBeLessThan(0.05);
    expect(second(await through('fuzz'))).toBeGreaterThan(0.008);
    for (const id of ['clean', 'overdrive', 'distortion'] as const) {
      expect(second(await through(id))).toBeLessThan(0.001);
    }
  });
});

describe('level', () => {
  it('keeps every preset within 3 dB of its bypassed level, off the limiter', async () => {
    const level = async (id: EffectPresetId): Promise<number> => {
      const { ctx, manual, strip } = rig(2);
      strip.setEffects(stagesOf(id));
      play(ctx, pluckedLine(ctx), strip.input);
      return rms((await render(ctx, manual)).getChannelData(0), 0.1, 1.9);
    };
    const reference = await level('off');
    for (const id of EFFECT_PRESET_IDS) {
      expect(Math.abs(decibels((await level(id)) / reference)), id).toBeLessThanOrEqual(3);
    }
  });
});

/** Two strips beside each other in one 4-channel render: channels 0 and 1, and 2 and 3. */
function pair(seconds: number) {
  const ctx = context(seconds, 4);
  const manual = new ManualDefer();
  const bank = new ImpulseBank(ctx);
  const dead = ctx.createGain();
  const effects = { impulses: () => bank, reverb: () => dead, defer: manual.defer };
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 4 });
  merger.connect(ctx.destination);
  const strips = [0, 2].map((first) => {
    const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    splitter.connect(merger, 0, first);
    splitter.connect(merger, 1, first + 1);
    return new ChannelStrip(ctx, splitter, effects);
  });
  const [plain, effected] = strips;
  if (!plain || !effected) throw new Error('no strips');
  const buffer = sineBuffer(ctx, 330, 0.3, 0.2);
  for (const strip of strips) play(ctx, buffer, strip.input);
  return { ctx, manual, plain, effected };
}

/** The bits of a channel over `[from, to]`: equal bits means equal samples, the sign of zero too. */
function bits(rendered: AudioBuffer, channel: number, from: number, to: number): Uint32Array {
  const data = rendered.getChannelData(channel);
  const view = new Uint32Array(data.buffer, data.byteOffset, data.length);
  return view.slice(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE));
}

describe('bypass', () => {
  async function identical(spec: (effected: ChannelStrip) => (() => void)[]): Promise<void> {
    const { ctx, manual, effected } = pair(1.2);
    const actions = spec(effected).map((run, index) => ({ at: 0.1 + index * 0.2, run }));
    const rendered = await render(ctx, manual, actions);
    // Settled well before 0.7 s: the fade ends 20 ms after the last switch at 0.3 s.
    for (const [plain, other] of [
      [0, 2],
      [1, 3],
    ] as const) {
      const a = bits(rendered, plain, 0.7, 1.2);
      const b = bits(rendered, other, 0.7, 1.2);
      expect(a.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
      expect(
        Math.max(...new Float32Array(a.buffer, a.byteOffset, a.length).map(Math.abs)),
      ).toBeGreaterThan(0.1);
    }
    expect(manual.pending).toBe(0);
    expect(effected.chain).toBeUndefined();
  }

  it('is bit-identical to no chain once the whole chain is bypassed', async () => {
    await identical((strip) => [
      () => {
        strip.setEffects(stagesOf('distortion'));
      },
      () => {
        strip.setEffects(undefined);
      },
    ]);
  });

  it('is bit-identical with every stage bypassed one by one', async () => {
    const some = new Set(EFFECT_STAGES);
    await identical((strip) => [
      () => {
        strip.setEffects(stagesOf('overdrive'));
      },
      () => {
        strip.setEffects(stagesOf('overdrive', some));
      },
    ]);
  });

  it('is bit-identical for a strip that never had a chain, though its preset resolved to none', async () => {
    await identical((strip) => [
      () => {
        strip.setEffects({});
      },
    ]);
  });

  it('is bit-identical after a chain with an echo is bypassed, tails and all', async () => {
    await identical((strip) => [
      () => {
        strip.setEffects(stagesOf('overdrive'));
      },
      () => {
        strip.setEffects(stagesOf('keys'));
      },
    ]);
  });

  it('disconnects the idle path: a stage leaves `engaged` once its fade is done', async () => {
    const { ctx, manual, strip } = rig(0.5);
    strip.setEffects(stagesOf('distortion'));
    let before: string[] = [];
    let after: string[] = [];
    await render(ctx, manual, [
      {
        at: 0.1,
        run: () => {
          before = strip.chain?.engaged ?? [];
          strip.setEffects(stagesOf('distortion', new Set(['cabinet'])));
        },
      },
      {
        at: 0.3,
        run: () => {
          after = strip.chain?.engaged ?? [];
        },
      },
    ]);
    expect(before).toContain('cabinet');
    expect(after).not.toContain('cabinet');
    expect(after).toContain('drive');
  });
});

describe('switching', () => {
  const SWITCH = 0.5;
  const distortion = stagesOf('distortion');
  const withoutDrive = stagesOf('distortion', new Set(['drive']));
  const cases: {
    name: string;
    start: EffectSpec | undefined;
    steps: (EffectSpec | undefined)[];
    gap?: number;
  }[] = [
    {
      name: 'the drive stage off',
      start: distortion,
      steps: [withoutDrive],
    },
    { name: 'the drive stage on', start: withoutDrive, steps: [distortion] },
    { name: 'the whole chain off', start: distortion, steps: [undefined] },
    { name: 'the whole chain on', start: undefined, steps: [distortion] },
    { name: 'distortion to clean', start: distortion, steps: [stagesOf('clean')] },
    {
      name: 'clean to fuzz (a new curve and impulse)',
      start: stagesOf('clean'),
      steps: [stagesOf('fuzz')],
    },
    {
      name: 'a reversal 10 ms into the fade',
      start: distortion,
      steps: [undefined, distortion],
      gap: 0.01,
    },
  ];

  it.each(cases)('is click-free for $name', async ({ start, steps, gap = 0 }) => {
    const { ctx, manual, strip } = rig(1.2);
    strip.setEffects(start);
    play(ctx, sineBuffer(ctx, FREQUENCY, 0.25), strip.input);
    const out = (
      await render(
        ctx,
        manual,
        steps.map((spec, index) => ({
          at: SWITCH + index * gap,
          run: () => {
            strip.setEffects(spec);
          },
        })),
        128,
      )
    ).getChannelData(0);
    const before: [number, number] = [0.3, 0.45];
    const after: [number, number] = [0.8, 1.1];
    const steady = Math.max(maxStep(out, ...before), maxStep(out, ...after));
    // Never louder than the louder of the states it moves between, or than the dry input.
    const level = Math.max(peak(out, ...before), peak(out, ...after), 0.25);
    expect(maxStep(out, SWITCH - 0.025, SWITCH + 0.075)).toBeLessThanOrEqual(1.2 * steady);
    expect(peak(out, SWITCH - 0.025, SWITCH + 0.075)).toBeLessThanOrEqual(1.05 * level);
  });
});

describe('delay', () => {
  it('echoes die away: each is quieter than the one before', async () => {
    const { ctx, manual, strip } = rig(1.6);
    strip.setEffects({ delay: { time: 0.2, feedback: 0.5, mix: 1 } });
    const burst = new AudioBuffer({
      length: ctx.length,
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
    });
    for (let channel = 0; channel < 2; channel += 1) {
      const data = burst.getChannelData(channel);
      for (let i = 0; i < 2000; i += 1)
        data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    }
    play(ctx, burst, strip.input);
    const out = (await render(ctx, manual)).getChannelData(0);
    const echo = (n: number): number => rms(out, 0.2 * n - 0.01, 0.2 * n + 0.06);
    expect(echo(1)).toBeGreaterThan(0.05);
    for (const n of [1, 2, 3, 4]) expect(echo(n + 1)).toBeLessThan(0.7 * echo(n));
  });
});

import { describe, expect, it, vi } from 'vitest';

import { ChannelStrip } from '../sampler/channel-strip';
import { EFFECT_PRESET_IDS, stagesOf } from './presets';
import type { EffectPresetId, EffectSpec } from './presets';
import { ImpulseBank } from './reverb-bus';
import {
  ManualDefer,
  SAMPLE_RATE,
  bandEnergy,
  context,
  decibels,
  dipDb,
  maxStep,
  monoOf,
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
  const level = async (id: EffectPresetId, db: number): Promise<{ rms: number; peak: number }> => {
    const { ctx, manual, strip } = rig(2);
    strip.setEffects(stagesOf(id));
    play(ctx, pluckedLine(ctx, db), strip.input);
    const out = (await render(ctx, manual)).getChannelData(0);
    return { rms: rms(out, 0.1, 1.9), peak: peak(out, 0.1, 1.9) };
  };

  // Forte is about -26 dBFS RMS for a GM note (loudness.test.ts: a forte steel note peaks near
  // -18 dBFS); mezzo is velocity 96 against 127, about 5 dB below. The saturating presets track
  // the input at roughly 0.9 dB per dB, so their makeup sits midway between the two levels.
  it.each([-26, -31])('keeps every preset within 3 dB of bypass at %i dBFS RMS', async (db) => {
    const reference = (await level('off', db)).rms;
    for (const id of EFFECT_PRESET_IDS) {
      expect(Math.abs(decibels((await level(id, db)).rms / reference)), id).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the peaks of a hot input bounded: no preset 3 dB over bypass at -18 dBFS RMS', async () => {
    const reference = (await level('off', -18)).peak;
    for (const id of EFFECT_PRESET_IDS) {
      expect(decibels((await level(id, -18)).peak / reference), id).toBeLessThanOrEqual(3);
    }
  });
});

describe('stereo image', () => {
  async function sides(spec: EffectSpec): Promise<[number, number]> {
    const { ctx, manual, strip } = rig(2);
    strip.setEffects(spec);
    // A voice with no pan is mono.
    play(ctx, monoOf(pluckedLine(ctx)), strip.input);
    const out = await render(ctx, manual);
    return [0, 1].map((channel) => rms(out.getChannelData(channel), 0.1, 1.9)) as [number, number];
  }

  it.each([
    ['the clean preset', stagesOf('clean')],
    ['the chorus alone', { modulation: { rate: 0.8, depth: 0.002, mix: 0.35 } }],
  ] as const)('keeps a mono source centred through %s (L and R within 0.5 dB)', async (_, spec) => {
    const [left, right] = await sides(spec);
    expect(left).toBeGreaterThan(0.01);
    expect(Math.abs(decibels(left / right))).toBeLessThanOrEqual(0.5);
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
  /**
   * Runs `steps` one `gap` apart from 0.1 s on the strip beside an untouched one, then compares
   * the last half second bit for bit.
   */
  async function identical(
    steps: (effected: ChannelStrip) => (() => void)[],
    { gap = 0.2, seconds = 1.2 } = {},
  ): Promise<void> {
    const { ctx, manual, effected } = pair(seconds);
    const actions = steps(effected).map((run, index) => ({ at: 0.1 + index * gap, run }));
    const rendered = await render(ctx, manual, actions);
    for (const [plain, other] of [
      [0, 2],
      [1, 3],
    ] as const) {
      const a = bits(rendered, plain, seconds - 0.5, seconds);
      const b = bits(rendered, other, seconds - 0.5, seconds);
      expect(a.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
      const floats = new Float32Array(a.buffer, a.byteOffset, a.length);
      expect(Math.max(...floats.map(Math.abs))).toBeGreaterThan(0.1);
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

  it('is bit-identical after every stage is bypassed one at a time, each through its own slot', async () => {
    const order = ['input', 'drive', 'tone', 'cabinet', 'delay', 'output'] as const;
    const changed: (number | undefined)[] = [];
    await identical(
      (strip) => [
        () => {
          strip.setEffects(stagesOf('overdrive'));
        },
        ...order.map((_, index) => () => {
          const spec = stagesOf('overdrive', new Set(order.slice(0, index + 1)));
          changed.push(strip.chain?.stagesChangedBy(spec));
          strip.setEffects(spec);
        }),
      ],
      { gap: 0.1, seconds: 1.6 },
    );
    // Each action switched exactly one stage: the per-stage crossfade, not a chain swap.
    expect(changed).toEqual(order.map(() => 1));
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
  type Spec = EffectSpec | undefined;
  interface Case {
    name: string;
    start: Spec;
    steps: Spec[];
    gap?: number;
  }
  const cases: Case[] = [
    { name: 'the drive stage off', start: distortion, steps: [withoutDrive] },
    { name: 'the drive stage on', start: withoutDrive, steps: [distortion] },
    { name: 'the whole chain off', start: distortion, steps: [undefined] },
    { name: 'the whole chain on', start: undefined, steps: [distortion] },
    { name: 'distortion to clean', start: distortion, steps: [stagesOf('clean')] },
    { name: 'clean to overdrive', start: stagesOf('clean'), steps: [stagesOf('overdrive')] },
    { name: 'clean to off', start: stagesOf('clean'), steps: [undefined] },
    {
      name: 'the cabinet toggled off',
      start: stagesOf('clean'),
      steps: [stagesOf('clean', new Set(['cabinet']))],
    },
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
    {
      name: 'a preset swapped back 5 ms later',
      start: stagesOf('fuzz'),
      steps: [stagesOf('clean'), stagesOf('fuzz')],
      gap: 0.005,
    },
  ];

  async function renderCase({ start, steps, gap = 0 }: Case): Promise<Float32Array> {
    const { ctx, manual, strip } = rig(1.2);
    strip.setEffects(start);
    play(ctx, sineBuffer(ctx, FREQUENCY, 0.25), strip.input);
    const actions = steps.map((spec, index) => ({
      at: SWITCH + index * gap,
      run: () => {
        strip.setEffects(spec);
      },
    }));
    return (await render(ctx, manual, actions, 128)).getChannelData(0);
  }

  const before: [number, number] = [0.3, 0.45];
  const after: [number, number] = [0.8, 1.1];

  /**
   * From the switch onward: a step or peak bigger than the steady states' own is a click. Two
   * correlated paths crossing over with equal-power gains sum to at most the square root of two
   * times either, so the bounds allow that and no more; a hard switch measures 2 to 3.5 times.
   */
  function clicks(out: Float32Array): boolean {
    const steady = Math.max(maxStep(out, ...before), maxStep(out, ...after));
    // Never louder than the louder of the states it moves between, or than the dry input.
    const level = Math.max(peak(out, ...before), peak(out, ...after), 0.25);
    return (
      maxStep(out, SWITCH, SWITCH + 0.045) > 1.5 * steady ||
      peak(out, SWITCH, SWITCH + 0.045) > 1.45 * level
    );
  }

  it.each(cases)('is click-free for $name', async (current) => {
    expect(clicks(await renderCase(current))).toBe(false);
  });

  it.each([
    ['distortion to dry', undefined],
    ['distortion to clean', stagesOf('clean')],
  ] as const)(
    'flags a hard switch, distortion to %s (the detector sees clicks)',
    async (_, end) => {
      const [from, to] = await Promise.all([
        renderCase({ name: '', start: distortion, steps: [] }),
        renderCase({ name: '', start: end, steps: [] }),
      ]);
      const hard = from.slice();
      hard.set(to.subarray(Math.round(SWITCH * SAMPLE_RATE)), Math.round(SWITCH * SAMPLE_RATE));
      expect(clicks(hard)).toBe(true);
    },
  );

  // The quietest 9 ms against the quieter of the two steady states in the same window: a
  // crossfade of two paths that cancel each other dips, which no step detector sees. A plucked
  // line, since a pure sine through a chorus sweeps its comb and would read as a dip of its own.
  const DIP_AT = 0.7;
  async function pluckedCase({ start, steps }: Case): Promise<Float32Array> {
    const { ctx, manual, strip } = rig(1.4);
    strip.setEffects(start);
    play(ctx, pluckedLine(ctx, -26, [196]), strip.input);
    const [end] = steps.slice(-1);
    const actions = [
      {
        at: DIP_AT,
        run: () => {
          strip.setEffects(end);
        },
      },
    ];
    return (await render(ctx, manual, actions, 128)).getChannelData(0);
  }

  it.each(cases.filter(({ name }) => /clean to (overdrive|off)|cabinet toggled/.test(name)))(
    'does not dip more than 3 dB for $name',
    async (current) => {
      const [out, a, b] = await Promise.all([
        pluckedCase(current),
        pluckedCase({ ...current, steps: [current.start] }),
        pluckedCase({ ...current, start: current.steps.at(-1), steps: current.steps }),
      ]);
      expect(dipDb(out, [a, b], DIP_AT - 0.005, DIP_AT + 0.05)).toBeGreaterThanOrEqual(-3);
    },
  );

  it('never leaves an oscillator started and not stopped, even when a preset is replaced at once', async () => {
    const start = vi.spyOn(OscillatorNode.prototype, 'start');
    const stop = vi.spyOn(OscillatorNode.prototype, 'stop');
    try {
      const { ctx, manual, strip } = rig(0.6);
      strip.setEffects(stagesOf('fuzz'));
      play(ctx, sineBuffer(ctx, FREQUENCY, 0.25), strip.input);
      const to = (spec: EffectSpec) => () => {
        strip.setEffects(spec);
      };
      await render(
        ctx,
        manual,
        [
          { at: 0.1, run: to(stagesOf('clean')) },
          { at: 0.105, run: to(stagesOf('fuzz')) },
          { at: 0.11, run: to(stagesOf('clean')) },
          {
            at: 0.4,
            run: () => {
              strip.dispose();
            },
          },
        ],
        128,
      );
      expect(start).toHaveBeenCalled();
      expect(stop).toHaveBeenCalledTimes(start.mock.calls.length);
    } finally {
      start.mockRestore();
      stop.mockRestore();
    }
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

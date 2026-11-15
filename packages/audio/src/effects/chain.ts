import { BypassSlot } from './bypass-slot';
import type { Defer, Path } from './bypass-slot';
import { CURVE_RANGE, DRIVE_OVERSAMPLE, driveCurve } from './curves';
import { INLINE_STAGES } from './presets';
import type { EffectSpec, InlineStage } from './presets';
import type { ImpulseBank } from './reverb-bus';

/** The smoothing time constant of continuous parameters, as the strip's fader has. */
const SMOOTHING = 0.005;
/** A delay time glides over a longer constant: a jump would be a pitch glitch, not a click. */
const DELAY_SMOOTHING = 0.05;
/** An amp is mono: the first stages take the sum, and a mono cabinet convolves half the work. */
const MONO = { channelCount: 1, channelCountMode: 'explicit' } as const;

const gainOf = (db: number): number => 10 ** (db / 20);

function smooth(param: AudioParam, value: number, context: BaseAudioContext, constant = SMOOTHING) {
  param.setTargetAtTime(value, context.currentTime, constant);
}

/** A built stage, which takes new continuous parameters in place. */
interface Built<P> extends Path {
  update(params: P): void;
}

interface StageDef<P> {
  /** Parameters that differ in key need a new path; the rest are set in place. */
  key(params: P): string;
  build(context: BaseAudioContext, impulses: ImpulseBank, params: P): Built<P>;
}

type Params<S extends InlineStage> = NonNullable<EffectSpec[S]>;

const input: StageDef<Params<'input'>> = {
  key: () => 'input',
  build(context, _impulses, params) {
    const gain = new GainNode(context, { ...MONO, gain: gainOf(params.gainDb) });
    return {
      head: gain,
      tail: gain,
      update: (next) => {
        smooth(gain.gain, gainOf(next.gainDb), context);
      },
      dispose: () => {
        gain.disconnect();
      },
    };
  },
};

const drive: StageDef<Params<'drive'>> = {
  key: ({ curve }) => curve,
  build(context, _impulses, { curve }) {
    // The gain in front shrinks the curve's +-CURVE_RANGE onto the shaper's +-1.
    const scale = new GainNode(context, { ...MONO, gain: 1 / CURVE_RANGE });
    const shaper = new WaveShaperNode(context, {
      ...MONO,
      curve: driveCurve(curve),
      oversample: DRIVE_OVERSAMPLE[curve],
    });
    // The fuzz curve is asymmetric, so it carries DC.
    const blocker = new BiquadFilterNode(context, {
      ...MONO,
      type: 'highpass',
      frequency: 25,
      Q: Math.SQRT1_2,
    });
    scale.connect(shaper).connect(blocker);
    return {
      head: scale,
      tail: blocker,
      update: () => undefined,
      dispose: () => {
        scale.disconnect();
        shaper.disconnect();
        blocker.disconnect();
      },
    };
  },
};

const tone: StageDef<Params<'tone'>> = {
  key: () => 'tone',
  build(context, _impulses, params) {
    const low = new BiquadFilterNode(context, {
      ...MONO,
      type: 'lowshelf',
      frequency: 120,
      gain: params.lowDb,
    });
    const mid = new BiquadFilterNode(context, {
      ...MONO,
      type: 'peaking',
      frequency: 750,
      Q: 0.8,
      gain: params.midDb,
    });
    const high = new BiquadFilterNode(context, {
      ...MONO,
      type: 'highshelf',
      frequency: 3200,
      gain: params.highDb,
    });
    low.connect(mid).connect(high);
    return {
      head: low,
      tail: high,
      update: (next) => {
        smooth(low.gain, next.lowDb, context);
        smooth(mid.gain, next.midDb, context);
        smooth(high.gain, next.highDb, context);
      },
      dispose: () => {
        low.disconnect();
        mid.disconnect();
        high.disconnect();
      },
    };
  },
};

const cabinet: StageDef<Params<'cabinet'>> = {
  key: ({ ir }) => ir,
  build(context, impulses, { ir }) {
    // A new convolver for each impulse: reassigning a live node's buffer is not glitch-free.
    const convolver = new ConvolverNode(context, {
      ...MONO,
      disableNormalization: true,
      buffer: impulses.cabinet(ir),
    });
    return {
      head: convolver,
      tail: convolver,
      update: () => undefined,
      dispose: () => {
        convolver.disconnect();
      },
    };
  },
};

/** Chorus: a short delay swung by a slow oscillator, the two sides in antiphase. */
const BASE_DELAY = 0.015;
const modulation: StageDef<Params<'modulation'>> = {
  key: () => 'modulation',
  build(context, _impulses, params) {
    const head = context.createGain();
    const tail = context.createGain();
    const dry = new GainNode(context, { gain: 1 - params.mix / 2 });
    const wet = new GainNode(context, { gain: params.mix });
    const splitter = new ChannelSplitterNode(context, { numberOfOutputs: 2 });
    const merger = new ChannelMergerNode(context, { numberOfInputs: 2 });
    const left = new DelayNode(context, { maxDelayTime: 0.05, delayTime: BASE_DELAY });
    const right = new DelayNode(context, { maxDelayTime: 0.05, delayTime: BASE_DELAY });
    const lfo = new OscillatorNode(context, { frequency: params.rate });
    const swingLeft = new GainNode(context, { gain: params.depth });
    const swingRight = new GainNode(context, { gain: -params.depth });
    head.connect(dry).connect(tail);
    head.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    merger.connect(wet).connect(tail);
    lfo.connect(swingLeft).connect(left.delayTime);
    lfo.connect(swingRight).connect(right.delayTime);
    lfo.start();
    const nodes = [head, tail, dry, wet, splitter, merger, left, right, swingLeft, swingRight];
    return {
      head,
      tail,
      update: (next) => {
        smooth(dry.gain, 1 - next.mix / 2, context);
        smooth(wet.gain, next.mix, context);
        smooth(lfo.frequency, next.rate, context);
        smooth(swingLeft.gain, next.depth, context);
        smooth(swingRight.gain, -next.depth, context);
      },
      dispose: () => {
        lfo.stop();
        lfo.disconnect();
        for (const node of nodes) node.disconnect();
      },
    };
  },
};

/** The most feedback a delay takes: past it, the echoes would not die away. */
export const MAX_FEEDBACK = 0.6;
const delay: StageDef<Params<'delay'>> = {
  key: () => 'delay',
  build(context, _impulses, params) {
    const feedbackOf = (value: number): number => Math.min(MAX_FEEDBACK, Math.max(0, value));
    const head = context.createGain();
    const tail = context.createGain();
    const dry = context.createGain();
    const wet = new GainNode(context, { gain: params.mix });
    const line = new DelayNode(context, { maxDelayTime: 1.5, delayTime: params.time });
    // The loop's lowpass darkens each repeat, as a tape or analogue line would.
    const damping = new BiquadFilterNode(context, { type: 'lowpass', frequency: 4000 });
    const feedback = new GainNode(context, { gain: feedbackOf(params.feedback) });
    head.connect(dry).connect(tail);
    head.connect(line);
    line.connect(wet).connect(tail);
    line.connect(damping).connect(feedback).connect(line);
    const nodes = [head, tail, dry, wet, line, damping, feedback];
    return {
      head,
      tail,
      update: (next) => {
        smooth(line.delayTime, next.time, context, DELAY_SMOOTHING);
        smooth(feedback.gain, feedbackOf(next.feedback), context);
        smooth(wet.gain, next.mix, context);
      },
      dispose: () => {
        for (const node of nodes) node.disconnect();
      },
    };
  },
};

const output: StageDef<Params<'output'>> = {
  key: () => 'output',
  build(context, _impulses, params) {
    const gain = new GainNode(context, { gain: gainOf(params.gainDb) });
    return {
      head: gain,
      tail: gain,
      update: (next) => {
        smooth(gain.gain, gainOf(next.gainDb), context);
      },
      dispose: () => {
        gain.disconnect();
      },
    };
  },
};

/** One stage's slot and what it wants, typed by its own parameters. */
class Stage<P> {
  readonly slot: BypassSlot;
  /** The key of the path wanted, `undefined` while bypassed. */
  #wanted: string | undefined;
  #params: P | undefined;
  #built: Built<P> | undefined;

  constructor(
    private readonly def: StageDef<P>,
    private readonly pick: (spec: EffectSpec) => P | undefined,
    slot: BypassSlot,
  ) {
    this.slot = slot;
  }

  /** Whether the stage is switched on, though its path may still be fading in or out. */
  get active(): boolean {
    return this.#wanted !== undefined;
  }

  /** Whether `spec` asks for a different path (or none) than this stage has now. */
  changes(spec: EffectSpec): boolean {
    const params = this.pick(spec);
    return (params ? this.def.key(params) : undefined) !== this.#wanted;
  }

  apply(
    spec: EffectSpec,
    context: BaseAudioContext,
    impulses: ImpulseBank,
    immediate: boolean,
  ): void {
    const params = this.pick(spec);
    if (!params) {
      this.#wanted = undefined;
      this.slot.set(undefined);
      return;
    }
    const key = this.def.key(params);
    this.#params = params;
    if (this.#wanted === key) {
      // Still being built after a duck: the build reads the latest params.
      this.#built?.update(params);
      return;
    }
    this.#wanted = key;
    this.slot.set(() => {
      const built = this.def.build(context, impulses, this.#params ?? params);
      this.#built = built;
      return built;
    }, immediate);
  }
}

/**
 * The strip's insert chain: each stage a `BypassSlot` between gain nodes, in signal order. A
 * stage's nodes exist only while it is active. Parameters that move continuously are smoothed in
 * place; a different curve or impulse response replaces the stage's path through a duck to dry.
 */
export class EffectsChain {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #stages: {
    stage: InlineStage;
    apply: Stage<unknown>['apply'];
    changes: Stage<unknown>['changes'];
    active: () => boolean;
    slot: BypassSlot;
  }[] = [];
  readonly #nodes: GainNode[];
  readonly #context: BaseAudioContext;
  readonly #impulses: ImpulseBank;

  constructor(context: BaseAudioContext, impulses: ImpulseBank, defer: Defer) {
    this.#context = context;
    this.#impulses = impulses;
    this.#nodes = Array.from({ length: INLINE_STAGES.length + 1 }, () => context.createGain());
    this.input = this.#nodes[0] ?? context.createGain();
    this.output = this.#nodes[INLINE_STAGES.length] ?? context.createGain();
    const slotOf = (stage: InlineStage): BypassSlot => {
      const index = INLINE_STAGES.indexOf(stage);
      const from = this.#nodes[index];
      const to = this.#nodes[index + 1];
      if (!from || !to) throw new Error(`EffectsChain: no nodes for ${stage}`);
      return new BypassSlot(context, from, to, defer);
    };
    this.#add('input', new Stage(input, (spec) => spec.input, slotOf('input')));
    this.#add('drive', new Stage(drive, (spec) => spec.drive, slotOf('drive')));
    this.#add('tone', new Stage(tone, (spec) => spec.tone, slotOf('tone')));
    this.#add('cabinet', new Stage(cabinet, (spec) => spec.cabinet, slotOf('cabinet')));
    this.#add('modulation', new Stage(modulation, (spec) => spec.modulation, slotOf('modulation')));
    this.#add('delay', new Stage(delay, (spec) => spec.delay, slotOf('delay')));
    this.#add('output', new Stage(output, (spec) => spec.output, slotOf('output')));
  }

  #add<P>(stage: InlineStage, runner: Stage<P>): void {
    this.#stages.push({
      stage,
      apply: runner.apply.bind(runner),
      changes: runner.changes.bind(runner),
      active: () => runner.active,
      slot: runner.slot,
    });
  }

  /** The stages switched on, a fade still running or not. */
  get active(): InlineStage[] {
    return this.#stages.filter(({ active }) => active()).map(({ stage }) => stage);
  }

  /** The stages with a processing path now (fading in or out included). */
  get engaged(): InlineStage[] {
    return this.#stages.filter(({ slot }) => slot.engaged).map(({ stage }) => stage);
  }

  /**
   * How many stages `spec` switches on, off or to another curve or impulse. One stage switches
   * itself with a crossfade; more than one is a preset change, which the strip swaps whole.
   */
  stagesChangedBy(spec: EffectSpec): number {
    return this.#stages.filter(({ changes }) => changes(spec)).length;
  }

  /** Moves every stage to `spec`; a fresh chain passes `immediate`, as the strip fades it in. */
  apply(spec: EffectSpec, immediate = false): void {
    for (const { apply } of this.#stages) apply(spec, this.#context, this.#impulses, immediate);
  }

  dispose(): void {
    for (const { slot } of this.#stages) slot.dispose();
    for (const node of this.#nodes) node.disconnect();
  }
}

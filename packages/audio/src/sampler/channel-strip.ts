const PARAM_SMOOTHING = 0.005;

export interface StripSettings {
  /** Linear gain. */
  gain?: number;
  /** -1 (left) to 1 (right). */
  pan?: number;
  mute?: boolean;
  solo?: boolean;
}

function smooth(param: AudioParam, value: number, context: BaseAudioContext): void {
  param.setTargetAtTime(value, context.currentTime, PARAM_SMOOTHING);
}

/**
 * input -> insert (input, output) -> fader -> panner -> mute gate -> master. The insert pair is
 * wired straight through until the effects chain replaces the connection between them.
 */
export class ChannelStrip {
  readonly input: GainNode;
  readonly insert: { readonly input: GainNode; readonly output: GainNode };
  readonly #context: BaseAudioContext;
  readonly #fader: GainNode;
  readonly #panner: StereoPannerNode;
  readonly #gate: GainNode;
  #gain = 1;
  #pan = 0;
  #mute = false;
  #solo = false;

  constructor(context: BaseAudioContext, destination: AudioNode) {
    this.#context = context;
    this.input = context.createGain();
    this.insert = { input: context.createGain(), output: context.createGain() };
    this.#fader = context.createGain();
    this.#panner = context.createStereoPanner();
    this.#gate = context.createGain();
    this.input.connect(this.insert.input);
    this.insert.input.connect(this.insert.output);
    this.insert.output.connect(this.#fader).connect(this.#panner).connect(this.#gate);
    this.#gate.connect(destination);
  }

  get mute(): boolean {
    return this.#mute;
  }

  get solo(): boolean {
    return this.#solo;
  }

  get gain(): number {
    return this.#gain;
  }

  get pan(): number {
    return this.#pan;
  }

  /** Mute and solo take effect through the mixer, which knows every strip's solo. */
  set(settings: StripSettings): void {
    if (settings.gain !== undefined) {
      this.#gain = settings.gain;
      smooth(this.#fader.gain, this.#gain, this.#context);
    }
    if (settings.pan !== undefined) {
      this.#pan = Math.min(1, Math.max(-1, settings.pan));
      smooth(this.#panner.pan, this.#pan, this.#context);
    }
    if (settings.mute !== undefined) this.#mute = settings.mute;
    if (settings.solo !== undefined) this.#solo = settings.solo;
  }

  setAudible(audible: boolean): void {
    smooth(this.#gate.gain, audible ? 1 : 0, this.#context);
  }

  dispose(): void {
    for (const node of [this.input, this.insert.input, this.insert.output, this.#fader]) {
      node.disconnect();
    }
    this.#panner.disconnect();
    this.#gate.disconnect();
  }
}

/** Every strip feeds this: a limiter, then the master gain. */
export class MasterBus {
  readonly input: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly output: GainNode;
  #gain = 1;

  constructor(context: BaseAudioContext, destination: AudioNode) {
    this.input = context.createGain();
    this.limiter = new DynamicsCompressorNode(context, {
      threshold: -1,
      knee: 0,
      ratio: 20,
      attack: 0.001,
      release: 0.1,
    });
    this.output = context.createGain();
    this.input.connect(this.limiter).connect(this.output).connect(destination);
  }

  set gain(value: number) {
    this.#gain = value;
    smooth(this.output.gain, value, this.output.context);
  }

  get gain(): number {
    return this.#gain;
  }

  dispose(): void {
    this.input.disconnect();
    this.limiter.disconnect();
    this.output.disconnect();
  }
}

/** Solo logic: with any strip soloed, only soloed strips sound; mute always wins. */
export function applySolo(strips: Iterable<ChannelStrip>): void {
  const all = [...strips];
  const anySolo = all.some((strip) => strip.solo);
  for (const strip of all) strip.setAudible(!strip.mute && (!anySolo || strip.solo));
}

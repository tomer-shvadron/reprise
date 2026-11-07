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

/** A change at `at`: a linear glide from `from` over `ramp` seconds, or a smoothed step. */
function schedule(param: AudioParam, from: number, value: number, at: number, ramp: number): void {
  if (ramp > 0) {
    param.setValueAtTime(from, at);
    param.linearRampToValueAtTime(value, at + ramp);
  } else {
    param.setTargetAtTime(value, at, PARAM_SMOOTHING);
  }
}

/** A value a parameter takes from `at` on; an immediate set is at the time of the call. */
interface Target {
  at: number;
  value: number;
}

/** The target in effect at `when`: the latest at or before it, the later one set on a tie. */
function targetAt(targets: readonly Target[], when: number): Target | undefined {
  let found: Target | undefined;
  for (const target of targets) if (target.at <= when) found = target;
  return found;
}

/** Keeps the target in effect now and every later one, then adds `next` in time order. */
function addTarget(targets: Target[], next: Target, now: number): Target[] {
  const current = targetAt(targets, now);
  const kept = targets.filter((target) => target === current || target.at > now);
  const index = kept.findIndex((target) => target.at > next.at);
  if (index < 0) kept.push(next);
  else kept.splice(index, 0, next);
  return kept;
}

/**
 * input -> mute gate -> insert (input, output) -> fader -> panner -> master, and previewInput
 * joining at the insert, past the gate. The insert pair is wired straight through until the
 * effects chain replaces the connection between them.
 */
export class ChannelStrip {
  readonly input: GainNode;
  /** Bypasses mute and solo, for notes previewed while editing. */
  readonly previewInput: GainNode;
  readonly insert: { readonly input: GainNode; readonly output: GainNode };
  readonly #context: BaseAudioContext;
  readonly #fader: GainNode;
  readonly #panner: StereoPannerNode;
  readonly #gate: GainNode;
  #gain = 1;
  #pan = 0;
  #gainTargets: Target[] = [{ at: -Infinity, value: 1 }];
  #panTargets: Target[] = [{ at: -Infinity, value: 0 }];
  #mute = false;
  #solo = false;

  constructor(context: BaseAudioContext, destination: AudioNode) {
    this.#context = context;
    this.input = context.createGain();
    this.previewInput = context.createGain();
    this.insert = { input: context.createGain(), output: context.createGain() };
    this.#fader = context.createGain();
    this.#panner = context.createStereoPanner();
    this.#gate = context.createGain();
    this.input.connect(this.#gate).connect(this.insert.input);
    this.previewInput.connect(this.insert.input);
    this.insert.input.connect(this.insert.output);
    this.insert.output.connect(this.#fader).connect(this.#panner).connect(destination);
  }

  get mute(): boolean {
    return this.#mute;
  }

  get solo(): boolean {
    return this.#solo;
  }

  /**
   * The last gain set, which a change scheduled with `at` reports from the call on, before it
   * lands: the target the mixer shows, not the level the fader passes at `currentTime`.
   */
  get gain(): number {
    return this.#gain;
  }

  /** The last pan set; like `gain`, the target of a scheduled change from the call on. */
  get pan(): number {
    return this.#pan;
  }

  /**
   * Gain and pan now, or at `at` (gliding over `ramp` seconds) for a mixer change scheduled on a
   * beat. Mute and solo take effect now, through the mixer, which knows every strip's solo.
   */
  set(settings: StripSettings, at?: number, ramp = 0): void {
    const now = this.#context.currentTime;
    if (settings.gain !== undefined) {
      this.#apply(this.#fader.gain, this.#gain, settings.gain, at, ramp);
      this.#gain = settings.gain;
      this.#gainTargets = addTarget(
        this.#gainTargets,
        { at: at ?? now, value: settings.gain },
        now,
      );
    }
    if (settings.pan !== undefined) {
      const pan = Math.min(1, Math.max(-1, settings.pan));
      this.#apply(this.#panner.pan, this.#pan, pan, at, ramp);
      this.#pan = pan;
      this.#panTargets = addTarget(this.#panTargets, { at: at ?? now, value: pan }, now);
    }
    if (settings.mute !== undefined) this.#mute = settings.mute;
    if (settings.solo !== undefined) this.#solo = settings.solo;
  }

  /**
   * Drops the gain and pan changes scheduled after `when` and glides from there to the value in
   * effect at `when`, so a ramp cut midway neither freezes nor jumps back to where it began.
   */
  cancelAfter(when: number): void {
    this.#gainTargets = this.#cancel(this.#fader.gain, this.#gainTargets, when);
    this.#panTargets = this.#cancel(this.#panner.pan, this.#panTargets, when);
    this.#gain = this.#gainTargets.at(-1)?.value ?? this.#gain;
    this.#pan = this.#panTargets.at(-1)?.value ?? this.#pan;
  }

  #cancel(param: AudioParam, targets: readonly Target[], when: number): Target[] {
    const kept = targets.filter((target) => target.at <= when);
    if (kept.length === targets.length) return kept;
    // Firefox has no cancelAndHoldAtTime; there a ramp cut midway steps back before gliding.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- missing in Firefox, whatever lib.dom says
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(when);
    else param.cancelScheduledValues(when);
    const target = targetAt(kept, when);
    if (target) param.setTargetAtTime(target.value, when, PARAM_SMOOTHING);
    return kept;
  }

  setAudible(audible: boolean): void {
    smooth(this.#gate.gain, audible ? 1 : 0, this.#context);
  }

  #apply(
    param: AudioParam,
    from: number,
    value: number,
    at: number | undefined,
    ramp: number,
  ): void {
    if (at === undefined) smooth(param, value, this.#context);
    else schedule(param, from, value, at, ramp);
  }

  dispose(): void {
    for (const node of [
      this.input,
      this.previewInput,
      this.insert.input,
      this.insert.output,
      this.#fader,
    ]) {
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

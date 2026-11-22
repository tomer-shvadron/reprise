import { BypassSlot, realtimeDefer } from '../effects/bypass-slot';
import type { Defer, Path } from '../effects/bypass-slot';
import { EffectsChain } from '../effects/chain';
import { WahPedal } from '../effects/wah';
import type { WahState } from '../wah-lane';
import { INLINE_STAGES } from '../effects/presets';
import type { EffectSpec } from '../effects/presets';
import { ImpulseBank } from '../effects/reverb-bus';

const PARAM_SMOOTHING = 0.005;
/** A send at zero this long is disconnected, its fade-out long done. */
const SEND_IDLE_SECONDS = 0.1;

/** What a strip needs to build effects; the sampler shares one bank and one reverb bus. */
export interface StripEffects {
  /** The shared impulse responses, made on first use. */
  impulses(): ImpulseBank;
  /** The input of the shared reverb bus, made on first use; the strip's post-pan send feeds it. */
  reverb(): AudioNode;
  defer: Defer;
}

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

/**
 * A value a parameter takes from `at` on, reached at `end` (after a ramp); an immediate set is at
 * the time of the call.
 */
interface Target {
  at: number;
  end: number;
  value: number;
}

function targetOf(at: number | undefined, ramp: number, now: number, value: number): Target {
  return at === undefined ? { at: now, end: now, value } : { at, end: at + ramp, value };
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
 * joining at the insert, past the gate. Between the insert pair is a gain-1 direct connection and,
 * while the track has an effects chain, the chain beside it (a `BypassSlot` crossfades them). A
 * post-pan send feeds the shared reverb bus. A strip with no chain is the direct connection only.
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
  #gainTargets: Target[] = [{ at: -Infinity, end: -Infinity, value: 1 }];
  #panTargets: Target[] = [{ at: -Infinity, end: -Infinity, value: 0 }];
  #mute = false;
  #solo = false;
  readonly #effects: StripEffects;
  readonly #slot: BypassSlot;
  #chain: EffectsChain | undefined;
  #spec = '{}';
  #send: GainNode | undefined;
  #sendLevel = 0;
  #wah: WahPedal | undefined;
  #previewWah: WahPedal | undefined;

  constructor(context: BaseAudioContext, destination: AudioNode, effects?: StripEffects) {
    this.#context = context;
    let own: ImpulseBank | undefined;
    this.#effects = effects ?? {
      impulses: () => (own ??= new ImpulseBank(context)),
      reverb: () => {
        throw new Error('ChannelStrip: no reverb bus');
      },
      defer: realtimeDefer(context),
    };
    this.input = context.createGain();
    this.previewInput = context.createGain();
    this.insert = { input: context.createGain(), output: context.createGain() };
    this.#fader = context.createGain();
    this.#panner = context.createStereoPanner();
    this.#gate = context.createGain();
    this.input.connect(this.#gate).connect(this.insert.input);
    this.previewInput.connect(this.insert.input);
    this.#slot = new BypassSlot(
      context,
      this.insert.input,
      this.insert.output,
      this.#effects.defer,
    );
    this.insert.output.connect(this.#fader).connect(this.#panner).connect(destination);
  }

  /** The effects chain while the track has one: its stages, or `undefined` for the direct path. */
  get chain(): EffectsChain | undefined {
    return this.#chain;
  }

  /** The wah pedal, once a mark has asked for one. */
  get wah(): WahPedal | undefined {
    return this.#wah;
  }

  /**
   * The wah pedal's state from `at`. The pedal is spliced in between the mute gate and the
   * insert on the first call that needs it, before the effects, as a pedal sits before the amp,
   * and stays for the strip's life: off it is the dry signal exactly. A restore to `off` on a
   * strip that never had one changes nothing. Notes previewed in the editor have a pedal of
   * their own (`preview`).
   */
  setWah(state: WahState, at: number, restore = false, preview = false): void {
    if (preview) {
      this.#setPreviewWah(state, at, restore);
      return;
    }
    if (!this.#wah) {
      if (state === 'off') return;
      const pedal = new WahPedal(this.#context);
      this.#gate.disconnect(this.insert.input);
      this.#gate.connect(pedal.input);
      pedal.output.connect(this.insert.input);
      this.#wah = pedal;
    }
    this.#wah.set(state, at, restore);
  }

  /**
   * The pedal of previewed notes (`previewBeat`), a second one in front of the insert so a
   * preview hears its own wah while the song's pedal, which a run restores, is never moved.
   * `previewInput` joins it once built. A change cancels what an earlier preview scheduled
   * after it (its undo), so two quick previews do not undo each other.
   */
  #setPreviewWah(state: WahState, at: number, restore: boolean): void {
    if (!this.#previewWah) {
      if (state === 'off') return;
      const pedal = new WahPedal(this.#context);
      this.previewInput.disconnect(this.insert.input);
      this.previewInput.connect(pedal.input);
      pedal.output.connect(this.insert.input);
      this.#previewWah = pedal;
    }
    if (!restore) this.#previewWah.cancelAfter(at);
    this.#previewWah.set(state, at, restore);
  }

  /**
   * A new `previewNote` starts clean: the preview pedal, if a `previewBeat` built one, goes off at
   * `at` and its pending undo is cancelled, so the note is not filtered by an earlier preview.
   */
  resetPreviewWah(at: number): void {
    if (!this.#previewWah) return;
    this.#previewWah.cancelAfter(at);
    this.#previewWah.set('off', at, true);
  }

  /** The send into the reverb bus, while it is connected. */
  get reverbSend(): GainNode | undefined {
    return this.#send;
  }

  /**
   * Moves the strip to `spec`: builds, changes or drops the chain (a switch is a 20 ms crossfade,
   * and an idle path is disconnected after it), and sets the reverb send. A spec with no insert
   * stage leaves the direct connection alone, which is bit-identical to a strip with no effects.
   */
  setEffects(spec: EffectSpec | undefined): void {
    const key = JSON.stringify(spec ?? {});
    if (key === this.#spec) return;
    this.#spec = key;
    const inline = spec !== undefined && INLINE_STAGES.some((stage) => spec[stage] !== undefined);
    if (spec && inline) {
      if (this.#chain && this.#chain.stagesChangedBy(spec) <= 1) {
        // One stage's switch is its own crossfade.
        this.#chain.apply(spec);
      } else {
        // A preset change moves several stages whose levels differ mid-fade: cross over from the
        // old chain to a new one, built only here, when the slot asks for it.
        this.#slot.set(() => this.#build(spec), false, true);
      }
    } else if (this.#chain) {
      this.#chain = undefined;
      this.#slot.set(undefined);
    }
    this.#setSend(spec?.reverb?.send ?? 0);
  }

  #build(spec: EffectSpec): Path {
    const chain = new EffectsChain(this.#context, this.#effects.impulses(), this.#effects.defer);
    chain.apply(spec, true);
    this.#chain = chain;
    return {
      head: chain.input,
      tail: chain.output,
      dispose: () => {
        chain.dispose();
      },
    };
  }

  #setSend(level: number): void {
    this.#sendLevel = level;
    if (level > 0) {
      if (!this.#send) {
        const send = this.#context.createGain();
        send.gain.value = 0;
        this.#panner.connect(send);
        send.connect(this.#effects.reverb());
        this.#send = send;
      }
      smooth(this.#send.gain, level, this.#context);
      return;
    }
    const send = this.#send;
    if (!send) return;
    smooth(send.gain, 0, this.#context);
    this.#effects.defer(this.#context.currentTime + SEND_IDLE_SECONDS, () => {
      if (this.#send !== send || this.#sendLevel > 0) return;
      this.#panner.disconnect(send);
      send.disconnect();
      this.#send = undefined;
    });
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
      this.#gainTargets = addTarget(this.#gainTargets, targetOf(at, ramp, now, settings.gain), now);
    }
    if (settings.pan !== undefined) {
      const pan = Math.min(1, Math.max(-1, settings.pan));
      this.#apply(this.#panner.pan, this.#pan, pan, at, ramp);
      this.#pan = pan;
      this.#panTargets = addTarget(this.#panTargets, targetOf(at, ramp, now, pan), now);
    }
    if (settings.mute !== undefined) this.#mute = settings.mute;
    if (settings.solo !== undefined) this.#solo = settings.solo;
  }

  /**
   * Drops the gain and pan changes scheduled after `when`, holds a ramp still moving then, and
   * glides from there to the value in effect at `when`, so a ramp cut midway neither freezes nor
   * jumps back to where it began, and a set made at `when` lands after it.
   */
  cancelAfter(when: number): void {
    this.#gainTargets = this.#cancel(this.#fader.gain, this.#gainTargets, when);
    this.#panTargets = this.#cancel(this.#panner.pan, this.#panTargets, when);
    this.#wah?.cancelAfter(when);
    this.#gain = this.#gainTargets.at(-1)?.value ?? this.#gain;
    this.#pan = this.#panTargets.at(-1)?.value ?? this.#pan;
  }

  #cancel(param: AudioParam, targets: readonly Target[], when: number): Target[] {
    const kept = targets.filter((target) => target.at <= when);
    // A ramp still moving at `when` would otherwise land after the caller's reset and win.
    if (kept.length === targets.length && !kept.some((target) => target.end > when)) return kept;
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
    // First: it disconnects its own edges from the insert, which the loop below would sever.
    this.#slot.dispose();
    this.#wah?.dispose();
    this.#wah = undefined;
    this.#previewWah?.dispose();
    this.#previewWah = undefined;
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
    this.#chain = undefined;
    this.#send?.disconnect();
    this.#send = undefined;
  }
}

/** Linear until -1 dBFS, then rounded off towards -0.2 dBFS; see `ceilingCurve`. */
const CEILING_KNEE = 10 ** (-1 / 20);
const CEILING_LEVEL = 10 ** (-0.2 / 20);
/** The curve spans +-4 (+12 dBFS) so the limiter's overshoot is shaped rather than clipped at 1. */
const CEILING_RANGE = 4;
/** Odd, so the middle sample is exactly 0 and silence stays silent. */
const CEILING_SAMPLES = 8193;

/**
 * A soft ceiling: the identity below the knee, then a tanh that tends to `CEILING_LEVEL`. The
 * limiter's 1 ms attack lets peaks through (measured up to +2.4 dBFS on loud mixes); this catches
 * them without touching anything under the knee.
 */
function ceilingCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CEILING_SAMPLES);
  const room = CEILING_LEVEL - CEILING_KNEE;
  for (let i = 0; i < CEILING_SAMPLES; i += 1) {
    const x = ((i / (CEILING_SAMPLES - 1)) * 2 - 1) * CEILING_RANGE;
    const magnitude = Math.abs(x);
    const y =
      magnitude <= CEILING_KNEE
        ? magnitude
        : CEILING_KNEE + room * Math.tanh((magnitude - CEILING_KNEE) / room);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** Every strip feeds this: a limiter, the master gain, then a soft ceiling. */
export class MasterBus {
  readonly input: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly output: GainNode;
  readonly #ceiling: AudioNode[];
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
    // The shaper maps +-1 of its input to the curve's ends, so the gain in front shrinks +-4 to it.
    const scale = context.createGain();
    scale.gain.value = 1 / CEILING_RANGE;
    const shaper = new WaveShaperNode(context, { curve: ceilingCurve(), oversample: 'none' });
    this.#ceiling = [scale, shaper];
    this.input.connect(this.limiter).connect(this.output).connect(scale);
    scale.connect(shaper).connect(destination);
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
    for (const node of this.#ceiling) node.disconnect();
  }
}

/** Solo logic: with any strip soloed, only soloed strips sound; mute always wins. */
export function applySolo(strips: Iterable<ChannelStrip>): void {
  const all = [...strips];
  const anySolo = all.some((strip) => strip.solo);
  for (const strip of all) strip.setAudible(!strip.mute && (!anySolo || strip.solo));
}

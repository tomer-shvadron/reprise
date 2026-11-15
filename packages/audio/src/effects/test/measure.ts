import { ChannelStrip } from '../../sampler/channel-strip';
import type { StripEffects } from '../../sampler/channel-strip';
import { bandEnergy, peak, rms, toneLevel } from '../../sampler/test/offline';
import { ImpulseBank } from '../reverb-bus';
import type { Defer } from '../bypass-slot';

export const SAMPLE_RATE = 44_100;

export function context(seconds: number, channels = 2): OfflineAudioContext {
  return new OfflineAudioContext({
    numberOfChannels: channels,
    length: Math.round(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
}

/** A `defer` the test runs itself, from the suspensions of an offline render. */
export class ManualDefer {
  readonly #pending: { at: number; run: () => void }[] = [];

  readonly defer: Defer = (at, run) => {
    this.#pending.push({ at, run });
  };

  flush(now: number): void {
    for (const entry of this.#pending.filter(({ at }) => at <= now)) {
      this.#pending.splice(this.#pending.indexOf(entry), 1);
      entry.run();
    }
  }

  get pending(): number {
    return this.#pending.length;
  }
}

export interface Action {
  at: number;
  run: () => void;
}

/**
 * Renders `ctx`, suspending every `step` frames (a multiple of the 128-frame quantum) to run the
 * due actions and flush the deferred callbacks.
 */
export function render(
  ctx: OfflineAudioContext,
  manual: ManualDefer,
  actions: readonly Action[] = [],
  step = 512,
): Promise<AudioBuffer> {
  const pending = [...actions].sort((a, b) => a.at - b.at);
  for (let frame = step; frame < ctx.length; frame += step) {
    const at = frame / ctx.sampleRate;
    void ctx.suspend(at).then(() => {
      while (pending[0] && pending[0].at <= at) pending.shift()?.run();
      manual.flush(at);
      return ctx.resume();
    });
  }
  return ctx.startRendering();
}

export interface Rig {
  ctx: OfflineAudioContext;
  manual: ManualDefer;
  strip: ChannelStrip;
  effects: StripEffects;
  /** Where a strip's reverb send ends: a dead end, so the return is not in the measurement. */
  send: GainNode;
}

/** A strip into the destination, its reverb sends dead-ended, its idle paths flushed by `render`. */
export function rig(seconds: number, destination?: (ctx: OfflineAudioContext) => AudioNode): Rig {
  const ctx = context(seconds);
  const manual = new ManualDefer();
  const bank = new ImpulseBank(ctx);
  const send = ctx.createGain();
  const effects: StripEffects = { impulses: () => bank, reverb: () => send, defer: manual.defer };
  const strip = new ChannelStrip(ctx, destination?.(ctx) ?? ctx.destination, effects);
  return { ctx, manual, strip, effects, send };
}

/** A stereo buffer: a sine per channel at `amplitude`, optionally with seeded noise. */
export function sineBuffer(
  ctx: OfflineAudioContext,
  frequency: number,
  amplitude: number,
  noise = 0,
): AudioBuffer {
  const buffer = new AudioBuffer({
    length: ctx.length,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 2,
  });
  let seed = 12_345;
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const random = seed / 4_294_967_296 - 0.5;
      data[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) + noise * random;
    }
  }
  return buffer;
}

export function play(ctx: BaseAudioContext, buffer: AudioBuffer, to: AudioNode): void {
  const source = new AudioBufferSourceNode(ctx, { buffer });
  source.connect(to);
  source.start();
}

/** Harmonics 2 to 8 over the fundamental, from Hann-windowed Goertzel levels. */
export function thd(data: Float32Array, fundamental: number, from: number, to: number): number {
  const base = toneLevel(data, fundamental, from, to);
  let sum = 0;
  for (let k = 2; k <= 8; k += 1) sum += toneLevel(data, fundamental * k, from, to) ** 2;
  return Math.sqrt(sum) / base;
}

export { bandEnergy, peak, rms, toneLevel };

/** The largest sample-to-sample step in `[from, to]`. */
export function maxStep(data: Float32Array, from: number, to: number): number {
  let max = 0;
  const start = Math.max(1, Math.round(from * SAMPLE_RATE));
  const end = Math.min(data.length, Math.round(to * SAMPLE_RATE));
  for (let i = start; i < end; i += 1)
    max = Math.max(max, Math.abs((data[i] ?? 0) - (data[i - 1] ?? 0)));
  return max;
}

export const decibels = (ratio: number): number => 20 * Math.log10(ratio);

/**
 * A plucked line: harmonics at 1/k decaying over a pluck, a new pitch every half second, scaled
 * to `levelDb` dBFS RMS (-18 by default): the reference for level matching, close to a guitar's spectrum and dynamics.
 */
export function pluckedLine(
  ctx: OfflineAudioContext,
  levelDb = -18,
  pitches = [164.81, 220, 196, 246.94],
): AudioBuffer {
  const buffer = new AudioBuffer({
    length: ctx.length,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 2,
  });
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    const t = i / SAMPLE_RATE;
    const note = Math.floor(t / 0.5);
    const local = t - note * 0.5;
    const f = pitches[note % pitches.length] ?? 220;
    let sum = 0;
    for (let k = 1; k <= 6; k += 1) sum += Math.sin(2 * Math.PI * f * k * local) / k;
    data[i] = sum * Math.exp(-3 * local);
  }
  let power = 0;
  for (const value of data) power += value * value;
  const scale = 10 ** (levelDb / 20) / Math.sqrt(power / data.length);
  for (let i = 0; i < data.length; i += 1) data[i] = (data[i] ?? 0) * scale;
  buffer.copyToChannel(data, 1);
  return buffer;
}

/** A mono copy of a buffer's first channel: a voice with no pan is mono. */
export function monoOf(buffer: AudioBuffer): AudioBuffer {
  const mono = new AudioBuffer({ length: buffer.length, sampleRate: buffer.sampleRate });
  mono.copyToChannel(buffer.getChannelData(0), 0);
  return mono;
}

/**
 * The quietest 9 ms window (stepped by 1 ms) of `data` in `[from, to]`, in dB against the quieter
 * of two steady renders of the same source in the same window: a crossfade whose paths cancel
 * shows here as a dip, which a click detector cannot see. Comparing window by window keeps a
 * chorus sweeping or a note decaying out of the measurement.
 */
export function dipDb(
  data: Float32Array,
  steady: readonly [Float32Array, Float32Array],
  from: number,
  to: number,
): number {
  let worst = Infinity;
  for (let start = from; start + 0.009 <= to; start += 0.001) {
    const reference = Math.min(
      rms(steady[0], start, start + 0.009),
      rms(steady[1], start, start + 0.009),
    );
    worst = Math.min(worst, rms(data, start, start + 0.009) / reference);
  }
  return decibels(worst);
}

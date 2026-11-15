/** Seconds of a switch: long enough to be inaudible as a click, short enough to feel immediate. */
export const FADE_SECONDS = 0.02;

/** Runs `run` once the context's clock reaches `at`. */
export type Defer = (at: number, run: () => void) => void;

/** The default: poll the context's clock from a timer, and give up once the context is closed. */
export function realtimeDefer(context: BaseAudioContext): Defer {
  return (at, run) => {
    const check = (): void => {
      if (context.state === 'closed') return;
      const wait = (at - context.currentTime) * 1000;
      if (wait <= 0) run();
      else setTimeout(check, Math.max(5, wait));
    };
    setTimeout(check, Math.max(0, (at - context.currentTime) * 1000) + 5);
  };
}

/** A processing path between two nodes of its own, made and thrown away as a unit. */
export interface Path {
  head: AudioNode;
  tail: AudioNode;
  dispose(): void;
}

/**
 * Between `input` and `output`: a dry connection that is always there, and at most one processing
 * path beside it. A switch is a linear crossfade of `FADE_SECONDS` between them (a linear ramp
 * lands exactly on 0 and 1). When it ends the idle side is disconnected, so a bypassed slot is a
 * single gain-1 connection and the path's nodes stop costing CPU. A discrete change (a new curve
 * or impulse response) is a replace: fade to dry, swap, fade back.
 */
export class BypassSlot {
  readonly #context: BaseAudioContext;
  readonly #input: AudioNode;
  readonly #output: AudioNode;
  readonly #defer: Defer;
  readonly #dry: GainNode;
  #wet: GainNode | undefined;
  #path: Path | undefined;
  /** The wet share: `from` at `start`, `to` at `end`, linear between. */
  #fade = { from: 0, to: 0, start: 0, end: 0 };
  #token = 0;

  constructor(context: BaseAudioContext, input: AudioNode, output: AudioNode, defer: Defer) {
    this.#context = context;
    this.#input = input;
    this.#output = output;
    this.#defer = defer;
    this.#dry = context.createGain();
    input.connect(this.#dry).connect(output);
  }

  /** Whether a processing path is connected (it may be fading in or out). */
  get engaged(): boolean {
    return this.#path !== undefined;
  }

  /** The wet share at `now`, 0 to 1. */
  share(now = this.#context.currentTime): number {
    const { from, to, start, end } = this.#fade;
    if (now >= end) return to;
    if (now <= start) return from;
    return from + ((to - from) * (now - start)) / (end - start);
  }

  /**
   * Engages `build()`'s path, or replaces the current one; with `undefined`, bypasses. `immediate`
   * skips the fade of a first engagement, for a path nothing was hearing yet.
   */
  set(build: (() => Path) | undefined, immediate = false): void {
    if (!build) {
      if (!this.#path) return;
      this.#fadeTo(0, () => {
        this.#drop();
      });
      return;
    }
    if (!this.#path) {
      this.#attach(build(), immediate);
      return;
    }
    this.#fadeTo(0, () => {
      this.#drop();
      this.#attach(build(), false);
    });
  }

  #attach(path: Path, immediate: boolean): void {
    this.#token += 1;
    const now = this.#context.currentTime;
    const wet = this.#context.createGain();
    wet.gain.value = immediate ? 1 : 0;
    this.#input.connect(path.head);
    path.tail.connect(wet).connect(this.#output);
    this.#wet = wet;
    this.#path = path;
    this.#fade = {
      from: immediate ? 1 : 0,
      to: 1,
      start: now,
      end: immediate ? now : now + FADE_SECONDS,
    };
    this.#dry.gain.cancelScheduledValues(now);
    if (immediate) {
      this.#dry.gain.setValueAtTime(0, now);
      return;
    }
    this.#fadeTo(1);
  }

  #drop(): void {
    const path = this.#path;
    if (!path) return;
    this.#input.disconnect(path.head);
    this.#wet?.disconnect();
    path.dispose();
    this.#wet = undefined;
    this.#path = undefined;
  }

  #fadeTo(target: number, then?: () => void): void {
    const now = this.#context.currentTime;
    const from = this.share(now);
    this.#token += 1;
    const token = this.#token;
    const end = now + FADE_SECONDS;
    this.#fade = { from, to: target, start: now, end };
    const params: [AudioParam, number, number][] = [[this.#dry.gain, 1 - from, 1 - target]];
    if (this.#wet) params.push([this.#wet.gain, from, target]);
    for (const [param, start, stop] of params) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(start, now);
      param.linearRampToValueAtTime(stop, end);
    }
    if (then) {
      this.#defer(end, () => {
        if (token === this.#token) then();
      });
    }
  }

  dispose(): void {
    this.#token += 1;
    this.#drop();
    this.#dry.disconnect();
  }
}

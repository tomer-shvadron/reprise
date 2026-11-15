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

/** Straight segments a glide is cut into: a ramp lands exactly on its end, a curve would not. */
const SEGMENTS = 10;

/**
 * A fade-in follows a quarter sine and a fade-out a quarter cosine, so two paths crossing over
 * keep their summed power level when they are uncorrelated (a straight crossfade of two such
 * paths dips 3 dB at its middle).
 */
function shape(progress: number, rising: boolean): number {
  return rising ? Math.sin((progress * Math.PI) / 2) : 1 - Math.cos((progress * Math.PI) / 2);
}

/** One gain that glides: `from` at `start`, `to` at `end`, on `shape` between. */
class Fader {
  readonly node: GainNode;
  from: number;
  to: number;
  start = 0;
  end = 0;

  constructor(node: GainNode, value: number) {
    this.node = node;
    this.from = value;
    this.to = value;
    node.gain.value = value;
  }

  value(now: number): number {
    if (now >= this.end) return this.to;
    if (now <= this.start) return this.from;
    const progress = (now - this.start) / (this.end - this.start);
    return this.from + (this.to - this.from) * shape(progress, this.to > this.from);
  }

  /** Glides to `target` from wherever the last glide has got to; the end lands exactly on it. */
  glide(target: number, now: number): void {
    const from = this.value(now);
    this.from = from;
    this.to = target;
    this.start = now;
    this.end = now + FADE_SECONDS;
    const { gain } = this.node;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(from, now);
    for (let step = 1; step <= SEGMENTS; step += 1) {
      const value =
        step === SEGMENTS ? target : from + (target - from) * shape(step / SEGMENTS, target > from);
      gain.linearRampToValueAtTime(value, now + (FADE_SECONDS * step) / SEGMENTS);
    }
  }
}

interface Lane {
  fader: Fader;
  path: Path;
}

/**
 * Between `input` and `output`: a dry connection that is always there, and processing paths
 * beside it. A switch is an equal-power crossfade of `FADE_SECONDS` (ten straight segments, which
 * land exactly on 0 and 1).
 * When it ends the idle side is disconnected, so a bypassed slot is a single gain-1 connection
 * and the path's nodes stop costing CPU.
 *
 * A path is engaged or bypassed against the dry connection. Replacing one either ducks (fade to
 * dry, swap, fade back: a discrete change of a single stage) or crosses over (`direct`: both
 * paths are heard through the fade, the dry connection stays out of it).
 */
export class BypassSlot {
  readonly #context: BaseAudioContext;
  readonly #input: AudioNode;
  readonly #output: AudioNode;
  readonly #defer: Defer;
  readonly #dry: Fader;
  #lanes: Lane[] = [];
  /** Bumped by every call, so a deferred step of an earlier one does nothing. */
  #token = 0;

  constructor(context: BaseAudioContext, input: AudioNode, output: AudioNode, defer: Defer) {
    this.#context = context;
    this.#input = input;
    this.#output = output;
    this.#defer = defer;
    this.#dry = new Fader(context.createGain(), 1);
    input.connect(this.#dry.node).connect(output);
  }

  /** Whether a processing path is connected (it may be fading in or out). */
  get engaged(): boolean {
    return this.#lanes.length > 0;
  }

  /**
   * Engages `build()`'s path, or replaces the current one; with `undefined`, bypasses. `immediate`
   * skips the fade of a first engagement, for a path nothing was hearing yet. With `direct` a
   * replacement crosses over from the old path to the new one instead of ducking to dry.
   */
  set(build: (() => Path) | undefined, immediate = false, direct = false): void {
    this.#token += 1;
    const token = this.#token;
    const now = this.#context.currentTime;
    if (!build) {
      if (this.#lanes.length === 0) return;
      this.#fadeOut(now);
      this.#dry.glide(1, now);
      return;
    }
    if (this.#lanes.length === 0) {
      this.#attach(build(), now, immediate);
      return;
    }
    if (direct) {
      this.#fadeOut(now);
      this.#attach(build(), now, false);
      return;
    }
    this.#fadeOut(now);
    this.#dry.glide(1, now);
    this.#defer(now + FADE_SECONDS, () => {
      if (token !== this.#token) return;
      this.#dropAll();
      this.#attach(build(), this.#context.currentTime, false);
    });
  }

  #attach(path: Path, now: number, immediate: boolean): void {
    const fader = new Fader(this.#context.createGain(), immediate ? 1 : 0);
    this.#input.connect(path.head);
    path.tail.connect(fader.node).connect(this.#output);
    this.#lanes.push({ fader, path });
    if (immediate) {
      this.#dry.from = 0;
      this.#dry.to = 0;
      this.#dry.end = now;
      this.#dry.node.gain.cancelScheduledValues(now);
      this.#dry.node.gain.setValueAtTime(0, now);
      return;
    }
    fader.glide(1, now);
    this.#dry.glide(0, now);
  }

  /** Fades every path out, and drops each when its last fade is done. */
  #fadeOut(now: number): void {
    for (const lane of this.#lanes) {
      lane.fader.glide(0, now);
      this.#defer(now + FADE_SECONDS, () => {
        // A fade restarted since (a reversal) ends later, and has its own callback.
        if (this.#lanes.includes(lane) && this.#context.currentTime >= lane.fader.end) {
          this.#drop(lane);
        }
      });
    }
  }

  #drop(lane: Lane): void {
    this.#input.disconnect(lane.path.head);
    lane.fader.node.disconnect();
    lane.path.dispose();
    this.#lanes = this.#lanes.filter((entry) => entry !== lane);
  }

  #dropAll(): void {
    for (const lane of [...this.#lanes]) this.#drop(lane);
  }

  dispose(): void {
    this.#token += 1;
    this.#dropAll();
    this.#dry.node.disconnect();
  }
}

import { ARTICULATION } from '../articulations/parameters';
import type { WahState } from '../wah-lane';
import { FADE_SECONDS } from './bypass-slot';

const { closed, open, q, glide, makeup } = ARTICULATION.wah;

const CENTRE: Readonly<Record<'open' | 'closed', number>> = { open, closed };

/**
 * A wah pedal: `input -> dry -> output` beside `input -> band-pass -> makeup -> wet -> output`.
 * Off is dry 1 and wet 0, so the output is the input exactly. Engaging crossfades over
 * `FADE_SECONDS` (linear: the two paths are correlated), and a move between closed and open
 * glides the centre frequency with a time constant of `glide`.
 *
 * Everything is scheduled on `AudioParam`s at the time of the change, sample-accurate and with no
 * timer, so a render offline sounds as the realtime one does.
 */
export class WahPedal {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly filter: BiquadFilterNode;
  readonly #dry: GainNode;
  readonly #wet: GainNode;
  readonly #makeup: GainNode;
  /** Whether the last change scheduled leaves the pedal engaged; what the next one starts from. */
  #engaged = false;

  constructor(context: BaseAudioContext) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.#dry = context.createGain();
    this.#wet = context.createGain();
    this.#makeup = context.createGain();
    this.filter = context.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.Q.value = q;
    this.filter.frequency.value = closed;
    // Coefficients once per 128-frame block: plenty for a pedal, and far cheaper than per sample.
    this.filter.frequency.automationRate = 'k-rate';
    this.#makeup.gain.value = makeup;
    this.#wet.gain.value = 0;
    this.input.connect(this.#dry).connect(this.output);
    this.input.connect(this.filter).connect(this.#makeup).connect(this.#wet).connect(this.output);
  }

  /**
   * Moves the pedal to `state` at `when`. A `restore` sets the state at once, with no glide or
   * fade, as a run starts in it; otherwise an engage fades in and a move glides.
   */
  set(state: WahState, when: number, restore = false): void {
    const on = state !== 'off';
    if (restore) {
      if (on) this.filter.frequency.setValueAtTime(CENTRE[state], when);
      this.#dry.gain.setValueAtTime(on ? 0 : 1, when);
      this.#wet.gain.setValueAtTime(on ? 1 : 0, when);
    } else if (on && this.#engaged) {
      this.filter.frequency.setTargetAtTime(CENTRE[state], when, glide);
    } else if (on) {
      this.filter.frequency.setValueAtTime(CENTRE[state], when);
      this.#cross(0, 1, when);
    } else if (this.#engaged) {
      this.#cross(1, 0, when);
    }
    this.#engaged = on;
  }

  #cross(dry: number, wet: number, when: number): void {
    const end = when + FADE_SECONDS;
    this.#dry.gain.setValueAtTime(1 - dry, when);
    this.#dry.gain.linearRampToValueAtTime(dry, end);
    this.#wet.gain.setValueAtTime(1 - wet, when);
    this.#wet.gain.linearRampToValueAtTime(wet, end);
  }

  /** Drops the changes scheduled after `when`: the next run's restore sets the state again. */
  cancelAfter(when: number): void {
    for (const param of [this.filter.frequency, this.#dry.gain, this.#wet.gain]) {
      // Firefox has no cancelAndHoldAtTime, whatever lib.dom says.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(when);
      else param.cancelScheduledValues(when);
    }
  }

  dispose(): void {
    for (const node of [this.input, this.output, this.#dry, this.#wet, this.#makeup, this.filter]) {
      node.disconnect();
    }
  }
}

import type { Region } from './region-map';

/** -80 dB: the floor exponential ramps aim at, since they cannot reach zero. */
const SILENCE = 1e-4;
const MIN_ATTACK = 0.001;
const MIN_RELEASE = 0.005;
export const STEAL_FADE = 0.005;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** The MIDI volume curve: velocity 64 is about -12 dB. */
export function velocityGain(velocity: number): number {
  const clamped = Math.min(127, Math.max(0, velocity));
  return (clamped / 127) ** 2;
}

export interface VoiceStart {
  track: string;
  region: Region;
  buffer: AudioBuffer;
  key: number;
  velocity: number;
  when: number;
  /** Seconds into the sample, for a retrigger that skips the attack. */
  offset?: number;
  /** 0 when the note has no string to choke. */
  string?: number;
}

export interface FilterSettings {
  type?: BiquadFilterType;
  frequency: number;
  q?: number;
}

/**
 * One sounding sample: source -> envelope gain -> filter -> level gain -> channel strip. The
 * envelope gain carries the ADSR, the level gain velocity, region volume and the dB automation,
 * so articulations never fight the envelope for the same `AudioParam`.
 */
export class Voice {
  readonly track: string;
  readonly key: number;
  readonly velocity: number;
  readonly string: number;
  readonly startTime: number;
  letRing = false;

  readonly #region: Region;
  readonly #source: AudioBufferSourceNode;
  readonly #envelope: GainNode;
  readonly #filter: BiquadFilterNode;
  readonly #level: GainNode;
  readonly #baseLevel: number;
  readonly #attack: number;
  readonly #sustain: number;
  readonly #playable: number;
  readonly #rate: number;
  #lowestDetune = 0;
  #releaseAt = Infinity;
  #releaseTime: number;
  #releaseFloor = SILENCE;
  #end = Infinity;
  #ended = false;

  constructor(
    context: BaseAudioContext,
    destination: AudioNode,
    start: VoiceStart,
    onEnded: (voice: Voice) => void,
  ) {
    const { region, buffer, when } = start;
    const envelope = region.envelope;
    this.track = start.track;
    this.key = start.key;
    this.velocity = start.velocity;
    this.string = start.string ?? 0;
    this.startTime = when;
    this.#region = region;
    this.#attack = Math.max(envelope.attack, MIN_ATTACK);
    this.#sustain = Math.min(1, Math.max(0, envelope.sustain));
    this.#releaseTime = Math.max(envelope.release, MIN_RELEASE);
    this.#rate = 2 ** ((start.key - region.rootKey + region.tune / 100) / 12);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.#rate;
    source.detune.setValueAtTime(0, when);
    if (region.loop) {
      source.loop = true;
      source.loopStart = region.loop.start;
      source.loopEnd = region.loop.end;
    }
    this.#source = source;

    this.#envelope = context.createGain();
    this.#filter = context.createBiquadFilter();
    this.#filter.type = 'lowpass';
    this.#filter.frequency.value = context.sampleRate / 2;
    // Butterworth, in the dB units lowpass Q uses: no resonant peak once a cutoff is lowered.
    this.#filter.Q.value = -3.0103;
    this.#level = context.createGain();
    this.#baseLevel = velocityGain(start.velocity) * dbToGain(-(region.volume ?? 0));
    this.#level.gain.setValueAtTime(this.#baseLevel, when);

    source.connect(this.#envelope).connect(this.#filter).connect(this.#level).connect(destination);
    this.#scheduleEnvelope(when);

    const offset = Math.min(Math.max(0, start.offset ?? 0), buffer.duration);
    this.#playable = buffer.duration - offset;
    if (!region.loop) this.#end = when + this.#playable / this.#rate;
    source.addEventListener('ended', () => {
      this.#ended = true;
      source.disconnect();
      this.#level.disconnect();
      onEnded(this);
    });
    source.start(when, offset);
  }

  get released(): boolean {
    return this.#releaseAt !== Infinity;
  }

  get releaseAt(): number {
    return this.#releaseAt;
  }

  /** When the voice is silent for good; an estimate for an unreleased, unlooped sample. */
  get endTime(): number {
    return this.#ended ? -Infinity : this.#end;
  }

  isSoundingAt(time: number): boolean {
    return !this.#ended && time >= this.startTime && time < this.#end;
  }

  release(at: number): void {
    this.#fadeOut(at, this.#releaseTime, SILENCE);
  }

  /** A fast fade for stealing, short enough not to count against the new note. */
  kill(at: number): void {
    this.#fadeOut(at, STEAL_FADE, 0);
  }

  /** Relative to the note's own pitch, in semitones; fractions are cents. */
  setDetune(semitones: number, at: number): void {
    this.#noteDetune(semitones);
    this.#source.detune.setValueAtTime(semitones * 100, at);
  }

  /** A linear glide from the previous automation point, arriving at `at`. */
  rampDetune(semitones: number, at: number): void {
    this.#noteDetune(semitones);
    this.#source.detune.linearRampToValueAtTime(semitones * 100, at);
  }

  detuneCurve(semitones: readonly number[], start: number, duration: number): void {
    for (const value of semitones) this.#noteDetune(value);
    this.#source.detune.setValueCurveAtTime(
      Float32Array.from(semitones, (value) => value * 100),
      start,
      duration,
    );
  }

  /** dB relative to the note's velocity level. */
  setGain(db: number, at: number): void {
    this.#level.gain.setValueAtTime(this.#baseLevel * dbToGain(db), at);
  }

  /** Linear in dB, arriving at `at`. */
  rampGain(db: number, at: number): void {
    this.#level.gain.exponentialRampToValueAtTime(
      Math.max(this.#baseLevel * dbToGain(db), SILENCE * SILENCE),
      at,
    );
  }

  setFilter(settings: FilterSettings, at: number): void {
    if (settings.type) this.#filter.type = settings.type;
    this.#filter.frequency.setValueAtTime(settings.frequency, at);
    if (settings.q !== undefined) this.#filter.Q.setValueAtTime(settings.q, at);
  }

  /** The level the envelope and velocity give at `time`, ignoring gain automation. */
  levelAt(time: number): number {
    if (time < this.startTime || time >= this.#end) return 0;
    if (time < this.#releaseAt) return this.#baseLevel * this.#envelopeAt(time);
    const from = this.#envelopeAt(this.#releaseAt);
    if (from <= this.#releaseFloor) return this.#baseLevel * from;
    const progress = (time - this.#releaseAt) / (this.#end - this.#releaseAt);
    const floor = Math.max(this.#releaseFloor, SILENCE);
    return this.#baseLevel * from * (floor / from) ** progress;
  }

  #envelopeAt(time: number): number {
    const { hold, decay } = this.#region.envelope;
    let elapsed = time - this.startTime;
    if (elapsed < this.#attack) return elapsed / this.#attack;
    elapsed -= this.#attack + hold;
    if (elapsed < 0) return 1;
    if (elapsed < decay) return Math.max(this.#sustain, SILENCE) ** (elapsed / decay);
    return this.#sustain;
  }

  #scheduleEnvelope(when: number): void {
    const { hold, decay } = this.#region.envelope;
    const gain = this.#envelope.gain;
    gain.setValueAtTime(0, when);
    const peak = when + this.#attack;
    gain.linearRampToValueAtTime(1, peak);
    if (this.#sustain >= 1) return;
    const decayStart = peak + hold;
    gain.setValueAtTime(1, decayStart);
    const decayEnd = decayStart + Math.max(decay, MIN_ATTACK);
    gain.exponentialRampToValueAtTime(Math.max(this.#sustain, SILENCE), decayEnd);
    if (this.#sustain === 0) gain.setValueAtTime(0, decayEnd);
  }

  #fadeOut(at: number, length: number, floor: number): void {
    const time = Math.max(at, this.startTime);
    const end = time + length;
    if (end >= this.#end || this.#ended) return;
    this.#releaseAt = time;
    this.#releaseFloor = floor;
    const gain = this.#envelope.gain;
    // Chromium's hold is a no-op when no ramp spans `time`; the explicit value anchors the fade.
    gain.cancelAndHoldAtTime(time);
    gain.setValueAtTime(this.#envelopeAt(time), time);
    if (floor > 0) gain.exponentialRampToValueAtTime(floor, end);
    else gain.linearRampToValueAtTime(0, end);
    gain.setValueAtTime(0, end);
    this.#end = end;
    this.#source.stop(end);
  }

  #noteDetune(semitones: number): void {
    if (this.#region.loop || semitones >= this.#lowestDetune) return;
    this.#lowestDetune = semitones;
    if (!this.released) {
      this.#end = this.startTime + this.#playable / (this.#rate * 2 ** (semitones / 12));
    }
  }
}

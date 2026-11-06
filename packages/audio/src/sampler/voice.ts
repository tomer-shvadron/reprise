import type { Region, RegionMap } from './region-map';

/** -80 dB: the floor exponential ramps aim at, since they cannot reach zero. */
const SILENCE = 1e-4;
const MIN_ATTACK = 0.001;
const MIN_RELEASE = 0.005;
export const STEAL_FADE = 0.005;
/** A string re-plucked: the new attack damps the old note this fast, whatever its release. */
export const CHOKE_FADE = 0.015;

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
  /** The map the region came from: exclusive classes choke within one instrument. */
  instrument?: RegionMap;
}

export interface FilterSettings {
  type?: BiquadFilterType;
  frequency: number;
  q?: number;
  /** dB, for the shelving and peaking types. */
  gain?: number;
}

/** A point of the level gain's automation, mirrored so the pool can rank a voice by what it plays. */
interface GainEvent {
  at: number;
  value: number;
  /** An exponential ramp arriving at `at`, rather than a step there. */
  ramp: boolean;
}

/**
 * One sounding sample: source -> envelope gain -> [region filter] -> filter -> level gain ->
 * channel strip, with a panner before the strip when the region pans. The envelope gain carries
 * the ADSR, the level gain velocity, region attenuation and the dB automation, so articulations
 * never fight the envelope for the same `AudioParam`; the region's own low-pass is a node of its
 * own, so an articulation that switches the filter's type keeps it.
 */
export class Voice {
  readonly track: string;
  readonly key: number;
  readonly velocity: number;
  readonly string: number;
  readonly startTime: number;
  readonly exclusiveClass: number;
  readonly instrument: RegionMap | undefined;
  letRing = false;

  readonly #region: Region;
  readonly #source: AudioBufferSourceNode;
  readonly #nodes: readonly AudioNode[];
  readonly #envelope: GainNode;
  readonly #filter: BiquadFilterNode;
  readonly #level: GainNode;
  readonly #baseLevel: number;
  readonly #gainEvents: GainEvent[];
  readonly #delay: number;
  readonly #attack: number;
  readonly #decay: number;
  readonly #sustain: number;
  readonly #playable: number;
  readonly #rate: number;
  #lowestDetune = 0;
  #detuneAnchored = false;
  #releaseAt = Infinity;
  #releaseFrom = 0;
  /** 0 marks a linear fade to zero; otherwise the exponential fade's target. */
  #releaseFloor = 0;
  #releaseTime: number;
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
    this.exclusiveClass = region.exclusiveClass ?? 0;
    this.instrument = start.instrument;
    this.#region = region;
    this.#delay = Math.max(envelope.delay ?? 0, 0);
    this.#attack = Math.max(envelope.attack, MIN_ATTACK);
    this.#decay = Math.max(envelope.decay, MIN_ATTACK);
    this.#sustain = Math.min(1, Math.max(0, envelope.sustain));
    this.#releaseTime = Math.max(envelope.release, MIN_RELEASE);
    this.#rate = 2 ** ((start.key - region.rootKey + region.tune / 100) / 12);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.#rate;
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
    this.#baseLevel = velocityGain(start.velocity) * dbToGain(-(region.attenuation ?? 0));
    this.#level.gain.setValueAtTime(this.#baseLevel, when);
    this.#gainEvents = [{ at: when, value: this.#baseLevel, ramp: false }];

    const nodes: AudioNode[] = [source, this.#envelope];
    if (region.filter) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(region.filter.cutoffHz, context.sampleRate / 2);
      filter.Q.value = region.filter.q;
      nodes.push(filter);
    }
    nodes.push(this.#filter, this.#level);
    if (region.pan) {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.min(1, Math.max(-1, region.pan));
      nodes.push(panner);
    }
    this.#nodes = nodes;
    let tail: AudioNode = source;
    for (const node of nodes.slice(1)) tail = tail.connect(node);
    tail.connect(destination);
    this.#scheduleEnvelope(when + this.#delay);

    const offset = Math.min(Math.max(0, start.offset ?? 0), buffer.duration);
    this.#playable = buffer.duration - offset;
    if (!region.loop) this.#end = when + this.#playable / this.#rate;
    source.addEventListener('ended', () => {
      this.#ended = true;
      for (const node of this.#nodes) node.disconnect();
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

  /** A new note on the same string: a short fade instead of the region's full release. */
  choke(at: number): void {
    this.#fadeOut(at, CHOKE_FADE, 0);
  }

  /** Relative to the note's own pitch, in semitones; fractions are cents. */
  setDetune(semitones: number, at: number): void {
    this.#detuneAnchored = true;
    this.#noteDetune(semitones);
    this.#source.detune.setValueAtTime(semitones * 100, at);
  }

  /** A linear glide from the previous automation point, arriving at `at`. */
  rampDetune(semitones: number, at: number): void {
    // Anchored lazily: Chromium skips a value curve starting mid-quantum after any event in that
    // quantum, so a curve from the onset must be the voice's first detune event; this anchor is
    // such an event, and a curve from `startTime` scheduled after it would be lost.
    if (!this.#detuneAnchored) this.#source.detune.setValueAtTime(0, this.startTime);
    this.#detuneAnchored = true;
    this.#noteDetune(semitones);
    this.#source.detune.linearRampToValueAtTime(semitones * 100, at);
  }

  detuneCurve(semitones: readonly number[], start: number, duration: number): void {
    this.#detuneAnchored = true;
    for (const value of semitones) this.#noteDetune(value);
    const [only] = semitones;
    if (only === undefined) return;
    if (semitones.length === 1) {
      this.#source.detune.setValueAtTime(only * 100, start);
      return;
    }
    this.#source.detune.setValueCurveAtTime(
      Float32Array.from(semitones, (value) => value * 100),
      start,
      duration,
    );
  }

  /** dB relative to the note's velocity level. */
  setGain(db: number, at: number): void {
    const value = this.#baseLevel * dbToGain(db);
    this.#level.gain.setValueAtTime(value, at);
    this.#noteGain({ at, value, ramp: false });
  }

  /** Linear in dB, arriving at `at`. */
  rampGain(db: number, at: number): void {
    const value = Math.max(this.#baseLevel * dbToGain(db), SILENCE * SILENCE);
    this.#level.gain.exponentialRampToValueAtTime(value, at);
    this.#noteGain({ at, value, ramp: true });
  }

  setFilter(settings: FilterSettings, at: number): void {
    if (settings.type) this.#filter.type = settings.type;
    this.#filter.frequency.setValueAtTime(settings.frequency, at);
    if (settings.q !== undefined) this.#filter.Q.setValueAtTime(settings.q, at);
    if (settings.gain !== undefined) this.#filter.gain.setValueAtTime(settings.gain, at);
  }

  /** What the voice plays at `time`: envelope × level gain, velocity and articulation automation included. */
  levelAt(time: number): number {
    if (time < this.startTime || time >= this.#end) return 0;
    return this.#gainAt(time) * this.#envelopeAt(time);
  }

  /** What a steal ranks the voice by: `levelAt`, or before its onset the level it starts at. */
  stealLevelAt(time: number): number {
    if (time <= this.startTime) return this.#gainAt(this.startTime);
    return this.levelAt(time);
  }

  /** The level gain's automation evaluated as Web Audio does: a step, or an exponential ramp from the previous point. */
  #gainAt(time: number): number {
    const events = this.#gainEvents;
    let index = -1;
    while (index + 1 < events.length && (events[index + 1]?.at ?? Infinity) <= time) index += 1;
    const current = events[index];
    if (!current) return this.#baseLevel;
    const next = events[index + 1];
    if (!next?.ramp || next.at <= current.at || current.value <= 0) return current.value;
    return (
      current.value * (next.value / current.value) ** ((time - current.at) / (next.at - current.at))
    );
  }

  #noteGain(event: GainEvent): void {
    const index = this.#gainEvents.findIndex((other) => other.at > event.at);
    if (index === -1) this.#gainEvents.push(event);
    else this.#gainEvents.splice(index, 0, event);
  }

  /** The envelope gain at `time`, including a release or steal fade in progress. */
  #envelopeAt(time: number): number {
    if (time < this.#releaseAt) return this.#shapeAt(time);
    const progress = (time - this.#releaseAt) / (this.#end - this.#releaseAt);
    if (this.#releaseFloor === 0) return this.#releaseFrom * (1 - progress);
    return this.#releaseFrom * (this.#releaseFloor / this.#releaseFrom) ** progress;
  }

  /** The ADSR before any fade, mirroring `#scheduleEnvelope`. */
  #shapeAt(time: number): number {
    let elapsed = time - this.startTime - this.#delay;
    if (elapsed < 0) return 0;
    if (elapsed < this.#attack) return elapsed / this.#attack;
    elapsed -= this.#attack + this.#region.envelope.hold;
    if (elapsed < 0 || this.#sustain >= 1) return 1;
    if (elapsed < this.#decay) return Math.max(this.#sustain, SILENCE) ** (elapsed / this.#decay);
    return this.#sustain;
  }

  /** From `when`, the onset plus the envelope's delay; the gain sits at 0 until then. */
  #scheduleEnvelope(when: number): void {
    const gain = this.#envelope.gain;
    // The gain's intrinsic value is 1, so a delayed envelope must hold 0 from the onset.
    if (when > this.startTime) gain.setValueAtTime(0, this.startTime);
    gain.setValueAtTime(0, when);
    const peak = when + this.#attack;
    gain.linearRampToValueAtTime(1, peak);
    if (this.#sustain >= 1) return;
    const decayStart = peak + this.#region.envelope.hold;
    gain.setValueAtTime(1, decayStart);
    const decayEnd = decayStart + this.#decay;
    gain.exponentialRampToValueAtTime(Math.max(this.#sustain, SILENCE), decayEnd);
    if (this.#sustain === 0) gain.setValueAtTime(0, decayEnd);
  }

  #fadeOut(at: number, length: number, floor: number): void {
    const time = Math.max(at, this.startTime);
    const end = time + length;
    if (end >= this.#end || this.#ended) return;
    const from = this.#envelopeAt(time);
    const exponential = floor > 0 && from > floor;
    this.#releaseAt = time;
    this.#releaseFrom = from;
    this.#releaseFloor = exponential ? floor : 0;
    this.#end = end;
    const gain = this.#envelope.gain;
    // Chromium's hold is a no-op when no ramp spans `time`; the explicit value anchors the fade.
    gain.cancelAndHoldAtTime(time);
    gain.setValueAtTime(from, time);
    if (exponential) gain.exponentialRampToValueAtTime(floor, end);
    else gain.linearRampToValueAtTime(0, end);
    gain.setValueAtTime(0, end);
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

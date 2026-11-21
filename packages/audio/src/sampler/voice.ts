import {
  MAX_DECAY_TIMECENTS,
  MAX_HOLD_TIMECENTS,
  evaluateModulators,
  keyScaledTime,
} from './region-map';
import type { ModulatorDeltas, Region, RegionMap } from './region-map';

/** -80 dB: the floor exponential ramps aim at, since they cannot reach zero. */
const SILENCE = 1e-4;
const MIN_ATTACK = 0.001;
const MIN_RELEASE = 0.005;
/** The most attenuation SF2 allows, 1440 cB. */
const MAX_ATTENUATION_DB = 144;
/** `initialFilterFc` in absolute cents (A4 = 6900): its legal range, and the open end of it. */
const MIN_CUTOFF_CENTS = 1500;
const OPEN_CUTOFF_CENTS = 13_500;
/** Q of a Butterworth low-pass in Web Audio's dB unit: the region filter at no resonance. */
const BUTTERWORTH_Q_DB = -3.0103;
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

function centsToHz(cents: number): number {
  return 440 * 2 ** ((cents - 6900) / 1200);
}

function hzToCents(hz: number): number {
  return 6900 + 1200 * Math.log2(hz / 440);
}

function clampCutoff(cents: number): number {
  return Math.min(OPEN_CUTOFF_CENTS, Math.max(MIN_CUTOFF_CENTS, cents));
}

/**
 * The region's low-pass for this note, or nothing when the note leaves it open. A region with
 * neither modulators nor a filter envelope (SFZ, a test instrument) holds its cutoff as given.
 * Otherwise the cutoff at rest moves with the note-on modulators, and the modulation envelope
 * drives it from there: SF2's envelope is linear in cents, so the attack is an exponential ramp
 * in hertz, a hold, then a ramp down to the sustain share of the depth. The release phase is not
 * modelled: the cutoff stays where the sustain leaves it.
 */
function regionFilter(
  context: BaseAudioContext,
  spec: NonNullable<Region['filter']>,
  deltas: ModulatorDeltas | undefined,
  when: number,
  key: number,
): BiquadFilterNode | undefined {
  const nyquist = context.sampleRate / 2;
  if (!deltas && !spec.envelope) {
    const node = context.createBiquadFilter();
    node.type = 'lowpass';
    node.frequency.value = Math.min(spec.cutoffHz, nyquist);
    node.Q.value = spec.q;
    return node;
  }
  const rest = clampCutoff(hzToCents(spec.cutoffHz) + (deltas?.filterCents ?? 0));
  const q = spec.q + (deltas?.filterQDb ?? 0);
  const envelope = spec.envelope;
  const depth = envelope ? envelope.cents + (deltas?.modEnvCents ?? 0) : 0;
  const peak = clampCutoff(rest + depth);
  const settled = clampCutoff(rest + depth * (envelope?.sustain ?? 1));
  const closes = (cents: number) => cents < OPEN_CUTOFF_CENTS - 0.5;
  if (
    !closes(rest) &&
    !(depth !== 0 && (closes(peak) || closes(settled))) &&
    q <= BUTTERWORTH_Q_DB + 1e-3
  ) {
    return undefined;
  }
  const hz = (cents: number) => Math.min(centsToHz(cents), nyquist);
  const node = context.createBiquadFilter();
  node.type = 'lowpass';
  node.Q.value = q;
  node.frequency.value = hz(rest);
  node.frequency.setValueAtTime(hz(rest), when);
  if (envelope && depth !== 0) {
    const start = when + envelope.delay;
    const top = start + Math.max(envelope.attack, MIN_ATTACK);
    node.frequency.setValueAtTime(hz(rest), start);
    node.frequency.exponentialRampToValueAtTime(hz(peak), top);
    const holdEnd =
      top + keyScaledTime(envelope.hold, envelope.holdPerKey, key, MAX_HOLD_TIMECENTS);
    node.frequency.setValueAtTime(hz(peak), holdEnd);
    if (envelope.sustain < 1) {
      node.frequency.exponentialRampToValueAtTime(
        hz(settled),
        holdEnd +
          Math.max(
            keyScaledTime(
              envelope.decay,
              envelope.decayPerKey,
              key,
              MAX_DECAY_TIMECENTS,
              envelope.decayScale,
            ),
            MIN_ATTACK,
          ),
      );
    }
  }
  return node;
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
  /** An editor preview: it chokes and is choked by previews only, never by the song's notes. */
  preview?: boolean;
  /** The map the region came from: exclusive classes choke within one instrument. */
  instrument?: RegionMap;
  /** A release region's voice: it never steals a slot and is the first a later note steals. */
  tail?: boolean;
  /**
   * A fixed offset from the key's pitch, in cents, folded into the playback rate: the second
   * string of a doubled course. It is not automation, so a bend's detune curve stacks on it.
   */
  tuneCents?: number;
  /** A fixed level trim in dB, folded into the voice's base level, so gain automation keeps it. */
  trimDb?: number;
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
  readonly preview: boolean;
  readonly startTime: number;
  /** The group that chokes this voice; a new note's own groups are read off its regions. */
  readonly offBy: number;
  readonly oneShot: boolean;
  /** A release region's voice: decoration, the first thing lost at the polyphony cap. */
  readonly tail: boolean;
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
  readonly #hold: number;
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
    this.preview = start.preview ?? false;
    this.startTime = when;
    this.offBy = region.offBy ?? region.exclusiveClass ?? 0;
    this.oneShot = region.oneShot ?? false;
    this.tail = start.tail ?? false;
    this.instrument = start.instrument;
    this.#region = region;
    this.#delay = Math.max(envelope.delay ?? 0, 0);
    this.#attack = Math.max(envelope.attack, MIN_ATTACK);
    // A key outside the region's range (the map falls back to the nearest region) keeps the
    // edge key's timing, as the per-key regions this replaces did.
    const scaleKey = Math.min(Math.max(start.key, region.keyLo), region.keyHi);
    this.#hold = keyScaledTime(envelope.hold, envelope.holdPerKey, scaleKey, MAX_HOLD_TIMECENTS);
    this.#decay = Math.max(
      keyScaledTime(
        envelope.decay,
        envelope.decayPerKey,
        scaleKey,
        MAX_DECAY_TIMECENTS,
        envelope.decayScale,
      ),
      MIN_ATTACK,
    );
    this.#sustain = Math.min(1, Math.max(0, envelope.sustain));
    this.#releaseTime = Math.max(envelope.release, MIN_RELEASE);
    this.#rate =
      2 ** ((start.key - region.rootKey + (region.tune + (start.tuneCents ?? 0)) / 100) / 12);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.#rate;
    if (region.loop) {
      source.loop = true;
      const unit = region.loop.unit === 'frames' ? buffer.sampleRate : 1;
      source.loopStart = region.loop.start / unit;
      source.loopEnd = region.loop.end / unit;
    }
    this.#source = source;

    this.#envelope = context.createGain();
    this.#filter = context.createBiquadFilter();
    this.#filter.type = 'lowpass';
    this.#filter.frequency.value = context.sampleRate / 2;
    // Butterworth, in the dB units lowpass Q uses: no resonant peak once a cutoff is lowered.
    this.#filter.Q.value = -3.0103;
    this.#level = context.createGain();
    // With modulators the velocity curve is one of them, folded into the attenuation (SF2 8.4);
    // without, it is the MIDI curve alone.
    const deltas = region.modulators
      ? evaluateModulators(region.modulators, start.key, start.velocity)
      : undefined;
    const trim = dbToGain(start.trimDb ?? 0);
    this.#baseLevel =
      trim *
      (deltas
        ? dbToGain(
            -Math.min(
              MAX_ATTENUATION_DB,
              Math.max(0, (region.attenuation ?? 0) + deltas.attenuationDb),
            ),
          )
        : velocityGain(start.velocity) ** (region.velocityTrack ?? 1) *
          dbToGain(-(region.attenuation ?? 0)));
    this.#level.gain.setValueAtTime(this.#baseLevel, when);
    this.#gainEvents = [{ at: when, value: this.#baseLevel, ramp: false }];

    const nodes: AudioNode[] = [source, this.#envelope];
    const lowpass = region.filter && regionFilter(context, region.filter, deltas, when, scaleKey);
    if (lowpass) nodes.push(lowpass);
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

    const offset = Math.min(
      Math.max(0, (start.offset ?? 0) + (region.startFrame ?? 0) / buffer.sampleRate),
      buffer.duration,
    );
    this.#playable = buffer.duration - offset;
    if (!region.loop) this.#end = when + this.#playable / this.#rate;
    source.addEventListener('ended', () => {
      this.#ended = true;
      for (const node of this.#nodes) node.disconnect();
      onEnded(this);
    });
    source.start(when, offset);
  }

  /**
   * The release voices queued for this note. A choke or steal at `t` cancels those that have not
   * started by `t`: a cut note has no tail. Tails already sounding are left to play out.
   */
  readonly tails: Voice[] = [];

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

  /** A note-off; a one-shot ignores it and plays to the end of its sample. */
  release(at: number): void {
    if (!this.oneShot) this.#fadeOut(at, this.#releaseTime, SILENCE);
  }

  /** Releases whatever the voice is, one-shot included: stop and seek silence a drum tail. */
  stop(at: number): void {
    this.#fadeOut(at, this.#releaseTime, SILENCE);
  }

  /** A fast fade for stealing, short enough not to count against the new note. */
  kill(at: number): void {
    // A tail that has not started never sounds: cancel it rather than fade it in at its start.
    if (this.tail && this.startTime > at) {
      this.cancel();
      return;
    }
    this.#fadeOut(at, STEAL_FADE, 0);
    this.#cancelTails(at);
  }

  /** A new note on the same string: a short fade instead of the region's full release. */
  choke(at: number): void {
    this.#fadeOut(at, CHOKE_FADE, 0);
    this.#cancelTails(at);
  }

  /** Silences a voice that has not started: no fade, since it never sounds. */
  cancel(): void {
    if (this.#ended) return;
    this.#releaseAt = this.startTime;
    this.#end = -Infinity;
    const gain = this.#envelope.gain;
    gain.cancelScheduledValues(0);
    gain.setValueAtTime(0, 0);
    this.#source.stop(0);
  }

  #cancelTails(at: number): void {
    for (const tail of this.tails) if (tail.startTime > at) tail.cancel();
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

  /**
   * What a steal ranks the voice by: `levelAt`, or, before its onset or inside its envelope delay,
   * the level it is about to sound at, so a delayed layer is not taken for a silent one.
   */
  stealLevelAt(time: number): number {
    if (time <= this.startTime + this.#delay) return this.#gainAt(Math.max(time, this.startTime));
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
    elapsed -= this.#attack + this.#hold;
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
    const decayStart = peak + this.#hold;
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

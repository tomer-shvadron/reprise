/** Opaque sample identity; only the `SampleSource` that issued it can resolve it. */
export type SampleRef = string;

/** Seconds for the times, a linear 0..1 gain for `sustain`. */
export interface Envelope {
  /** Silence before the attack while the sample already plays (SF2's `delayVolEnv`). 0 when absent. */
  delay?: number;
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
}

/** A modulator's input: a note-on value, shaped by SF2 2.04's curve, polarity and direction (8.2). */
export interface ModulatorSource {
  /** `none` is a constant 1, as a modulator with no controller. */
  input: 'none' | 'velocity' | 'key';
  curve: 'linear' | 'concave' | 'convex' | 'switch';
  negative: boolean;
  bipolar: boolean;
}

/** What a note-on modulator moves: attenuation, the cutoff, the filter envelope's depth, or Q. */
export type ModulatorDestination = 'attenuation' | 'filterFc' | 'modEnvToFilterFc' | 'filterQ';

/**
 * An SF2 modulator the voice evaluates once, at note-on. `amount` is in the destination's own
 * units: centibels for attenuation and Q, cents for the cutoff and the envelope depth.
 */
export interface NoteModulator {
  destination: ModulatorDestination;
  amount: number;
  source: ModulatorSource;
  amountSource: ModulatorSource;
  /** SF2 transform 2: the product's absolute value. */
  absolute: boolean;
}

/** The sums of a note's modulators per destination, in dB for attenuation and Q, cents otherwise. */
export interface ModulatorDeltas {
  attenuationDb: number;
  filterCents: number;
  modEnvCents: number;
  filterQDb: number;
}

const SOURCE_RANGE_DB = 40 / 96;

/** A curve on 0..1; concave and convex are SF2 2.04 8.2.1's 40/96-decade logarithms. */
function shape(curve: ModulatorSource['curve'], x: number): number {
  switch (curve) {
    case 'linear': {
      return x;
    }
    case 'concave': {
      return Math.min(1, Math.max(0, -SOURCE_RANGE_DB * Math.log10(1 - x)));
    }
    case 'convex': {
      return Math.min(1, Math.max(0, 1 + SOURCE_RANGE_DB * Math.log10(x)));
    }
    case 'switch': {
      return x >= 0.5 ? 1 : 0;
    }
  }
}

/**
 * Bipolar sources map to -1..1 first and the curve is mirrored over the two halves, an S shape,
 * as FluidSynth does; the switch is -1 or 1.
 */
function curved(source: ModulatorSource, value: number): number {
  const x = source.negative ? 1 - value : value;
  if (!source.bipolar) return shape(source.curve, x);
  const t = 2 * x - 1;
  if (source.curve === 'switch') return t >= 0 ? 1 : -1;
  if (source.curve === 'linear') return t;
  return t >= 0 ? shape(source.curve, t) : -shape(source.curve, -t);
}

function sourceValue(source: ModulatorSource, key: number, velocity: number): number {
  if (source.input === 'none') return 1;
  return curved(source, (source.input === 'key' ? key : velocity) / 127);
}

/** SF2 2.04 8.2: each modulator adds `amount x source x amountSource` to its destination. */
export function evaluateModulators(
  modulators: readonly NoteModulator[],
  key: number,
  velocity: number,
): ModulatorDeltas {
  const total = { attenuation: 0, filterFc: 0, modEnvToFilterFc: 0, filterQ: 0 };
  for (const modulator of modulators) {
    const product =
      modulator.amount *
      sourceValue(modulator.source, key, velocity) *
      sourceValue(modulator.amountSource, key, velocity);
    total[modulator.destination] += modulator.absolute ? Math.abs(product) : product;
  }
  return {
    attenuationDb: total.attenuation / 10,
    filterCents: total.filterFc,
    modEnvCents: total.modEnvToFilterFc,
    filterQDb: total.filterQ / 10,
  };
}

/** The common output of every loader: one sample mapped onto a key and velocity rectangle. */
export interface Region {
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  /** The MIDI note the sample sounds at unshifted. */
  rootKey: number;
  /** Fine tuning in cents, added to the shift from `rootKey`. */
  tune: number;
  sample: SampleRef;
  /**
   * Seconds into the decoded buffer, so a resampling decode keeps them valid; with `unit:
   * 'frames'` (SFZ, whose loader cannot know a file's rate before reading it) frames at the
   * buffer's own rate, which the voice divides by `buffer.sampleRate`.
   */
  loop?: { start: number; end: number; unit?: 'frames' };
  envelope: Envelope;
  /** An articulation layer (`palmMute`, `harmonic`, ...); absent is the default layer. */
  layer?: string;
  /** dB, positive is quieter (SF2's sign; an SFZ loader negates its `volume`). 0 when absent. */
  attenuation?: number;
  /** -1 (left) to 1 (right) for a mono sample; absent or 0 adds no panner to the voice. */
  pan?: number;
  /**
   * The region's low-pass, applied from the note's start, before any articulation filter. `q` is
   * the resonance in dB, Web Audio's lowpass unit: about -3 is Butterworth, 0 a flat 0 dB at
   * cutoff. `cutoffHz` is the cutoff at rest; with an `envelope` the voice moves it by `cents`
   * (an SF2 modulation envelope: linear in cents, `decay` the time to fall to `sustain`, 0..1 of
   * the depth, release not modelled), and note-on `modulators` can move all of them. A region
   * with neither holds `cutoffHz` for the whole note.
   */
  filter?: {
    cutoffHz: number;
    q: number;
    envelope?: {
      cents: number;
      delay: number;
      attack: number;
      hold: number;
      decay: number;
      sustain: number;
    };
  };
  /**
   * Note-on modulators, already merged with the soundfont's defaults. When present, the velocity
   * curve and the filter's velocity response come from them; when absent the voice applies the
   * MIDI velocity curve (v/127)^2 alone, which is what an SFZ pack and the synthetic test
   * instruments get.
   */
  modulators?: readonly NoteModulator[];
  /** A new note of the same class on the same track and instrument chokes this one (SF2 7.10). */
  exclusiveClass?: number;
  /** SFZ `offset`, in frames at the buffer's own rate, added to a request's `offset` (seconds). */
  startFrame?: number;
  /** SFZ `loop_mode=one_shot`: a note-off is ignored and the sample plays to its end. */
  oneShot?: boolean;
  /** 0..1, SFZ `amp_veltrack` / 100: without modulators the gain is `velocityGain(v) ** velocityTrack`. */
  velocityTrack?: number;
  /** SFZ `group`: a new note of this group chokes the voices whose `offBy` equals it. */
  group?: number;
  /**
   * SFZ `off_by`. SF2's `exclusiveClass` c reads as `group = offBy = c`, so only SFZ gets the
   * one-way choke (a closed hi-hat cuts the open one, not the reverse).
   */
  offBy?: number;
  /**
   * Absent plays at note-on (SFZ `attack`). A `release` region plays at the note's note-off, as a
   * one-shot outside the string choke (`RegionMap.resolveRelease`, `VoiceHandle.release`).
   */
  trigger?: 'release' | 'first' | 'legato';
  /**
   * SFZ `rt_decay`, release regions only: dB of attenuation per second the note was held before
   * its release, so a long note's release noise is quieter than a short one's. Absent is 0.
   */
  releaseDecay?: number;
  /** SFZ `seq_length` / `seq_position` (1-based): a round robin. */
  sequence?: { length: number; position: number };
  /** SFZ `lorand` / `hirand`, 0..1: plays when `lo <= random < hi`. */
  random?: { lo: number; hi: number };
}

/** The counters a caller keeps for the round robins and the legato test; absent means the first. */
export interface RegionSelection {
  /** How many notes of this key came before, for `sequence`. */
  sequence?: number;
  /** 0..1 draw, for `random`. */
  random?: number;
  /** A note started while another sounds, for `first` and `legato` triggers. */
  legato?: boolean;
}

const KEY_COUNT = 128;
const MAX_PERIOD = 256;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return Math.min(MAX_PERIOD, (a / gcd(a, b)) * b);
}

function checkRange(name: string, lo: number, hi: number): void {
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi > 127 || lo > hi) {
    throw new RangeError(`${name} range ${String(lo)}..${String(hi)} is not within 0..127`);
  }
}

function distance(value: number, lo: number, hi: number): number {
  if (value < lo) return lo - value;
  if (value > hi) return value - hi;
  return 0;
}

/**
 * Resolves a key, a velocity and an optional layer to its regions. Every exact match sounds, in
 * map order (SF2 layers zones by design); failing any, the one region nearest by key and then by
 * velocity, so a pack that stops short of a drop tuning still sounds, pitch-shifted. A layer the
 * map lacks falls back to the default layer, which is the filter-and-envelope path of ADR-0004.
 */
export class RegionMap {
  readonly regions: readonly Region[];
  /** Whether any region triggers on release: a map without them (every SF2 preset) skips `resolveRelease`. */
  readonly hasReleaseRegions: boolean;
  /** Whether any region plays only on a hammer-on or pull-off (`trigger=legato`). */
  readonly hasLegatoRegions: boolean;
  readonly #layers = new Map<
    string | undefined,
    { all: Region[]; byKey: Region[][]; selections?: RegionSelection[] }
  >();

  constructor(regions: readonly Region[]) {
    for (const region of regions) {
      checkRange('Key', region.keyLo, region.keyHi);
      checkRange('Velocity', region.velLo, region.velHi);
    }
    this.regions = regions;
    this.hasReleaseRegions = regions.some((region) => region.trigger === 'release');
    this.hasLegatoRegions = regions.some((region) => region.trigger === 'legato');
    for (const region of regions) {
      let layer = this.#layers.get(region.layer);
      if (!layer) {
        layer = { all: [], byKey: Array.from({ length: KEY_COUNT }, (): Region[] => []) };
        this.#layers.set(region.layer, layer);
      }
      layer.all.push(region);
      for (let key = region.keyLo; key <= region.keyHi; key += 1) layer.byKey[key]?.push(region);
    }
  }

  get layers(): string[] {
    return [...this.#layers.keys()].filter((layer) => layer !== undefined);
  }

  /** The first region `resolveAll` would return. */
  resolve(key: number, velocity: number, layer?: string): Region | undefined {
    return this.resolveAll(key, velocity, layer)[0];
  }

  /**
   * The regions a note on this key starts. Release regions never start at note-on (see
   * `resolveRelease`); `first`
   * regions play unless `select.legato`, `legato` regions only with it; a sequence region plays
   * when `((select.sequence ?? 0) % length) + 1` is its position, a random region when
   * `lo <= (select.random ?? 0) < hi`. The nearest-region fallback searches only the regions that
   * pass, so it never picks a release region.
   */
  resolveAll(key: number, velocity: number, layer?: string, select?: RegionSelection): Region[] {
    return this.#match(key, velocity, layer, (region) => plays(region, select));
  }

  /**
   * The release regions the note-off of a note on this key starts, with the same layer fallback
   * and the same `select` counters as `resolveAll` (a sequence or random release region plays
   * only when it passes). Key and velocity match exactly, with no nearest-region fallback: a
   * release region is limited by key or velocity on purpose, so a note-off outside them is
   * silent, as in SFZ. A map with none returns nothing, and an SF2 map never has any.
   */
  resolveRelease(
    key: number,
    velocity: number,
    layer?: string,
    select?: RegionSelection,
  ): Region[] {
    if (!this.hasReleaseRegions) return [];
    return this.#match(
      key,
      velocity,
      layer,
      (region) => region.trigger === 'release' && passes(region, select),
      true,
    );
  }

  /**
   * Every region a note on this key and velocity could start, or release, across all round-robin
   * and random positions and both legato states: what a preload must make resident, since a
   * release region has to be there at the note-off. The nearest-region fallback depends on the
   * selection (it searches only the regions that pass), so it runs once per distinct selection
   * and the results are united.
   */
  candidates(key: number, velocity: number, layer?: string): Region[] {
    const found = new Set([
      ...this.#match(key, velocity, layer, (region) => region.trigger !== 'release'),
      ...this.#match(key, velocity, layer, (region) => region.trigger === 'release', true),
    ]);
    for (const select of this.#selections(layer)) {
      for (const region of this.resolveAll(key, velocity, layer, select)) found.add(region);
      for (const region of this.resolveRelease(key, velocity, layer, select)) found.add(region);
    }
    return [...found];
  }

  /** The selections that can change what passes: every sequence position, random bucket and legato state. */
  #selections(layer: string | undefined): RegionSelection[] {
    const set = this.#set(layer);
    if (!set) return [];
    if (set.selections) return set.selections;
    let period = 1;
    const draws = new Set([0]);
    let legato = false;
    for (const region of set.all) {
      if (region.sequence) period = lcm(period, region.sequence.length);
      if (region.random) {
        draws.add(region.random.lo);
        draws.add(region.random.hi);
      }
      if (region.trigger === 'first' || region.trigger === 'legato') legato = true;
    }
    const selections: RegionSelection[] = [];
    // A round-robin period past the cap is cut short: the exact matches are still all included.
    for (let sequence = 0; sequence < Math.min(period, MAX_PERIOD); sequence += 1) {
      for (const random of draws) {
        if (random >= 1) continue;
        for (const flag of legato ? [false, true] : [false]) {
          selections.push({ sequence, random, legato: flag });
        }
      }
    }
    set.selections = selections;
    return selections;
  }

  #set(layer: string | undefined) {
    return (
      this.#layers.get(layer) ?? this.#layers.get(undefined) ?? this.#layers.values().next().value
    );
  }

  #match(
    key: number,
    velocity: number,
    layer: string | undefined,
    accept: (region: Region) => boolean,
    exactOnly = false,
  ): Region[] {
    const set = this.#set(layer);
    if (!set) return [];
    const exact =
      set.byKey[key]?.filter(
        (region) => velocity >= region.velLo && velocity <= region.velHi && accept(region),
      ) ?? [];
    if (exact.length > 0 || exactOnly) return exact;

    let best: Region | undefined;
    let bestKey = Infinity;
    let bestVelocity = Infinity;
    for (const region of set.all) {
      if (!accept(region)) continue;
      const keyDistance = distance(key, region.keyLo, region.keyHi);
      const velocityDistance = distance(velocity, region.velLo, region.velHi);
      if (keyDistance < bestKey || (keyDistance === bestKey && velocityDistance < bestVelocity)) {
        best = region;
        bestKey = keyDistance;
        bestVelocity = velocityDistance;
      }
    }
    return best ? [best] : [];
  }
}

function plays(region: Region, select: RegionSelection | undefined): boolean {
  const { trigger } = region;
  if (trigger === 'release') return false;
  if (trigger === 'first' && select?.legato) return false;
  if (trigger === 'legato' && !select?.legato) return false;
  return passes(region, select);
}

/** The round-robin and random tests, shared by note-on and release regions. */
function passes(region: Region, select: RegionSelection | undefined): boolean {
  const { sequence, random } = region;
  if (sequence && ((select?.sequence ?? 0) % sequence.length) + 1 !== sequence.position) {
    return false;
  }
  if (random) {
    const draw = select?.random ?? 0;
    if (draw < random.lo || draw >= random.hi) return false;
  }
  return true;
}

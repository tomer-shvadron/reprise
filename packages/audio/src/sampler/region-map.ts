/** Opaque sample identity; only the `SampleSource` that issued it can resolve it. */
export type SampleRef = string;

/** Seconds for the times, a linear 0..1 gain for `sustain`. */
export interface Envelope {
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
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
  /** Seconds into the decoded buffer, so a resampling decode keeps them valid. */
  loop?: { start: number; end: number };
  envelope: Envelope;
  /** An articulation layer (`palmMute`, `harmonic`, ...); absent is the default layer. */
  layer?: string;
  /** Attenuation in dB, 0 when absent. */
  volume?: number;
}

const KEY_COUNT = 128;

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
 * Resolves a key, a velocity and an optional layer to one region. An exact match wins, in map
 * order; failing that, the region nearest by key and then by velocity, so a pack that stops
 * short of a drop tuning still sounds, pitch-shifted. A layer the map lacks falls back to the
 * default layer, which is the filter-and-envelope path of ADR-0004.
 */
export class RegionMap {
  readonly regions: readonly Region[];
  readonly #layers = new Map<string | undefined, { all: Region[]; byKey: Region[][] }>();

  constructor(regions: readonly Region[]) {
    for (const region of regions) {
      checkRange('Key', region.keyLo, region.keyHi);
      checkRange('Velocity', region.velLo, region.velHi);
    }
    this.regions = regions;
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

  resolve(key: number, velocity: number, layer?: string): Region | undefined {
    const set =
      this.#layers.get(layer) ?? this.#layers.get(undefined) ?? this.#layers.values().next().value;
    if (!set) return undefined;
    const exact = set.byKey[key]?.find(
      (region) => velocity >= region.velLo && velocity <= region.velHi,
    );
    if (exact) return exact;

    let best: Region | undefined;
    let bestKey = Infinity;
    let bestVelocity = Infinity;
    for (const region of set.all) {
      const keyDistance = distance(key, region.keyLo, region.keyHi);
      const velocityDistance = distance(velocity, region.velLo, region.velHi);
      if (keyDistance < bestKey || (keyDistance === bestKey && velocityDistance < bestVelocity)) {
        best = region;
        bestKey = keyDistance;
        bestVelocity = velocityDistance;
      }
    }
    return best;
  }
}

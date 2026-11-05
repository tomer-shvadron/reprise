import { RegionMap } from '../../sampler/region-map';
import type { Envelope, Region, SampleRef } from '../../sampler/region-map';
import { MEGABYTE } from '../managed-sample-source';
import type { InstrumentId, RawSample, SampleProvider } from '../types';

const ENVELOPE: Envelope = { attack: 0.001, hold: 0, decay: 0, sustain: 1, release: 0.05 };

export interface SyntheticOptions {
  sampleRate?: number;
  /** Semitones per zone; a soundfont samples every few. */
  zoneWidth?: number;
  channels?: number;
  /** Decoded bytes of the whole instrument, every zone resident. */
  instrumentBytes?: (instrument: InstrumentId) => number;
  /** Holds every fetch until `release()`. */
  deferred?: boolean;
}

/** FNV-1a, so a size derived from an id is the same on every run. */
function hash(text: string): number {
  let value = 0x81_1c_9d_c5;
  for (const char of text) value = Math.imul(value ^ (char.codePointAt(0) ?? 0), 0x01_00_01_93);
  return value >>> 0;
}

/**
 * Sized like GeneralUser GS decoded to Float32 at its native rates: a melodic preset or a kit
 * between 1 and 4 MB with every zone resident. Deliberately above the real bank's average, so a
 * budget that holds here holds there.
 */
export function generalUserBytes(instrument: InstrumentId): number {
  return Math.round((1 + (hash(instrument) % 3001) / 1000) * MEGABYTE);
}

/**
 * A provider of silent samples in key zones, `<instrument>#<zone>`, with a region map per
 * instrument and a log of what was fetched.
 */
export class SyntheticProvider implements SampleProvider {
  readonly sampleRate: number;
  readonly zoneWidth: number;
  readonly channels: number;
  readonly fetched: SampleRef[] = [];
  readonly #instrumentBytes: (instrument: InstrumentId) => number;
  readonly #deferred: boolean;
  readonly #held: (() => void)[] = [];
  readonly #maps = new Map<InstrumentId, RegionMap>();
  failing = new Set<SampleRef>();

  constructor(options: SyntheticOptions = {}) {
    this.sampleRate = options.sampleRate ?? 32_000;
    this.zoneWidth = options.zoneWidth ?? 3;
    this.channels = options.channels ?? 1;
    this.#instrumentBytes = options.instrumentBytes ?? generalUserBytes;
    this.#deferred = options.deferred ?? false;
  }

  get zones(): number {
    return Math.ceil(128 / this.zoneWidth);
  }

  ref(instrument: InstrumentId, key: number): SampleRef {
    return `${instrument}#${String(Math.floor(key / this.zoneWidth))}`;
  }

  instrumentOf(ref: SampleRef): InstrumentId {
    return ref.slice(0, ref.lastIndexOf('#'));
  }

  frames(ref: SampleRef): number {
    const bytes = this.#instrumentBytes(this.instrumentOf(ref)) / this.zones;
    return Math.max(1, Math.round(bytes / (this.channels * Float32Array.BYTES_PER_ELEMENT)));
  }

  byteLength(ref: SampleRef): number {
    return this.frames(ref) * this.channels * Float32Array.BYTES_PER_ELEMENT;
  }

  async fetch(ref: SampleRef): Promise<RawSample> {
    this.fetched.push(ref);
    if (this.#deferred) {
      await new Promise<void>((resolve) => {
        this.#held.push(resolve);
      });
    }
    if (this.failing.has(ref)) throw new Error(`Cannot read ${ref}`);
    const frames = this.frames(ref);
    return {
      sampleRate: this.sampleRate,
      channels: Array.from({ length: this.channels }, () => new Float32Array(frames)),
      byteLength: frames * this.channels * 2,
    };
  }

  /** Lets every held fetch finish. */
  release(): void {
    for (const resolve of this.#held.splice(0)) resolve();
  }

  regionMap = (instrument: InstrumentId): RegionMap => {
    let map = this.#maps.get(instrument);
    if (!map) {
      const regions = Array.from({ length: this.zones }, (_, zone): Region => {
        const keyLo = zone * this.zoneWidth;
        return {
          keyLo,
          keyHi: Math.min(127, keyLo + this.zoneWidth - 1),
          velLo: 1,
          velHi: 127,
          rootKey: keyLo,
          tune: 0,
          sample: this.ref(instrument, keyLo),
          envelope: ENVELOPE,
        };
      });
      map = new RegionMap(regions);
      this.#maps.set(instrument, map);
    }
    return map;
  };
}

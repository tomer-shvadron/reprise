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
  /** The sample set an instrument plays from; instruments sharing a set share its samples. */
  sampleSet?: (instrument: InstrumentId) => string;
  /** Decoded bytes of a whole sample set, every zone resident. */
  setBytes?: (set: string) => number;
  /** Instruments `instrumentsOf` knows before any region map is asked for. */
  instruments?: readonly InstrumentId[];
  /** Holds every fetch until `release()`. */
  deferred?: boolean;
}

/** FNV-1a, so a size derived from an id is the same on every run. */
function hash(text: string): number {
  let value = 0x81_1c_9d_c5;
  for (const char of text) value = Math.imul(value ^ (char.codePointAt(0) ?? 0), 0x01_00_01_93);
  return value >>> 0;
}

const weight = (set: string) => 0.5 + (hash(set) % 1000) / 1000;

/** GeneralUser GS's GM set as WP-032 measured it, decoded to Float32. */
export const GM_PER_PRESET_BYTES = 121.6 * MEGABYTE;
export const GM_DEDUPLICATED_BYTES = 71.5 * MEGABYTE;

/**
 * A GM set shaped like GeneralUser GS: 128 bank-0 programs and the standard kit, where the
 * first six programs of each family share samples in pairs (as its string sections do), sized
 * so the presets add up to 121.6 MiB and the distinct samples to 71.5 MiB.
 */
export function generalUserGs(): Required<
  Pick<SyntheticOptions, 'instruments' | 'sampleSet' | 'setBytes'>
> {
  const instruments = [
    ...Array.from({ length: 128 }, (_, program) => `gm:0:${String(program)}`),
    'gm:drums:0',
  ];
  const sampleSet = (instrument: InstrumentId): string => {
    const program = /^gm:0:(\d+)$/.exec(instrument)?.[1];
    if (program === undefined) return instrument;
    const slot = Number(program) % 8;
    return slot < 6 ? `gm:0:${String(Number(program) - (slot % 2))}` : instrument;
  };
  const sets = [...new Set(instruments.map(sampleSet))];
  const shared = new Set(
    sets.filter((set) => instruments.filter((i) => sampleSet(i) === set).length > 1),
  );
  const sharedTotal = GM_PER_PRESET_BYTES - GM_DEDUPLICATED_BYTES;
  const groups = [
    { total: sharedTotal, members: sets.filter((set) => shared.has(set)) },
    { total: GM_DEDUPLICATED_BYTES - sharedTotal, members: sets.filter((set) => !shared.has(set)) },
  ];
  const sizes = new Map<string, number>();
  for (const { total, members } of groups) {
    const sum = members.reduce((acc, set) => acc + weight(set), 0);
    for (const set of members) sizes.set(set, (total * weight(set)) / sum);
  }
  const single = groups[1];
  const mean = single ? single.total / single.members.length : MEGABYTE;
  return { instruments, sampleSet, setBytes: (set) => sizes.get(set) ?? mean * weight(set) };
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
  readonly #sampleSet: (instrument: InstrumentId) => string;
  readonly #setBytes: (set: string) => number;
  readonly #members = new Map<string, Set<InstrumentId>>();
  readonly #deferred: boolean;
  readonly #held: (() => void)[] = [];
  readonly #maps = new Map<InstrumentId, RegionMap>();
  failing = new Set<SampleRef>();

  constructor(options: SyntheticOptions = {}) {
    this.sampleRate = options.sampleRate ?? 32_000;
    this.zoneWidth = options.zoneWidth ?? 3;
    this.channels = options.channels ?? 1;
    this.#sampleSet = options.sampleSet ?? ((instrument) => instrument);
    this.#setBytes = options.setBytes ?? (() => 4 * MEGABYTE);
    this.#deferred = options.deferred ?? false;
    for (const instrument of options.instruments ?? []) this.#register(instrument);
  }

  #register(instrument: InstrumentId): string {
    const set = this.#sampleSet(instrument);
    let members = this.#members.get(set);
    if (!members) {
      members = new Set();
      this.#members.set(set, members);
    }
    members.add(instrument);
    return set;
  }

  get zones(): number {
    return Math.ceil(128 / this.zoneWidth);
  }

  ref(instrument: InstrumentId, key: number): SampleRef {
    return `${this.#register(instrument)}#${String(Math.floor(key / this.zoneWidth))}`;
  }

  #setOf(ref: SampleRef): string {
    return ref.slice(0, ref.lastIndexOf('#'));
  }

  instrumentsOf(ref: SampleRef): InstrumentId[] {
    const set = this.#setOf(ref);
    return [...(this.#members.get(set) ?? [set])];
  }

  frames(ref: SampleRef): number {
    const bytes = this.#setBytes(this.#setOf(ref)) / this.zones;
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

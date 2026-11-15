import { RegionMap } from '../sampler/region-map';
import type { SampleRef } from '../sampler/region-map';
import type { InstrumentId, RawSample, SampleProvider } from '../samples/types';
import { SAMPLE_LIMITS, decodeAtNativeRate, sniffSampleHeader } from './decode';
import type { SfzDecoder } from './decode';
import { loadSfz } from './load';
import { resolvePath } from './paths';
import type { SfzReport } from './report';
import type { SfzLayer } from './resolve';

export interface SfzFiles {
  /** Reads one pack file; `path` is relative to the pack root and '/'-separated. */
  read(path: string): Promise<Uint8Array>;
  /** Size in bytes, for the byte estimate before a file is decoded; unknown is fine. */
  size?(path: string): number | undefined;
}

export interface SfzPackOptions {
  /** Prefix of every sample ref, `sfz:<id>/`. No slash. */
  id: string;
  files: SfzFiles;
  /** Decodes at the file's rate; `decodeAudioData` on an offline context by default. */
  decode?: SfzDecoder;
}

export interface SfzInstrument {
  id: InstrumentId;
  regions: RegionMap;
  layers: SfzLayer[];
  keyswitchRange?: { lo: number; hi: number };
  report: SfzReport;
}

/** Decoded Float32 bytes per file byte, by container: a guess good enough to reserve with. */
const EXPANSION: Readonly<Record<string, number>> = {
  wav: 2,
  flac: 4,
  ogg: 10,
  opus: 10,
};

function tooBig(ref: SampleRef, what: string, bytes: number): Error {
  return new RangeError(
    `Sample ${ref}: ${what} of ${String(bytes)} bytes is over the cap of ${String(
      what === 'file' ? SAMPLE_LIMITS.fileBytes : SAMPLE_LIMITS.decodedBytes,
    )}`,
  );
}

function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
}

/**
 * One SFZ pack as a `SampleProvider`: one ref per sample file, `sfz:<packId>/<path>`, however
 * many regions play it. Loading an instrument reads SFZ text only; a sample file is read and
 * decoded on the first `fetch`, which the memory manager issues from its preload plan or on a
 * miss, and its eviction and budget are the manager's.
 */
export class SfzPack implements SampleProvider {
  readonly id: string;
  readonly #prefix: string;
  readonly #files: SfzFiles;
  readonly #decode: SfzDecoder;
  readonly #owners = new Map<SampleRef, Set<InstrumentId>>();
  /** Exact decoded bytes of every file fetched so far. */
  readonly #decoded = new Map<SampleRef, number>();

  constructor(options: SfzPackOptions) {
    if (options.id === '' || options.id.includes('/')) {
      throw new RangeError(`Pack id "${options.id}" must be non-empty and hold no slash`);
    }
    this.id = options.id;
    this.#prefix = `sfz:${options.id}/`;
    this.#files = options.files;
    this.#decode = options.decode ?? decodeAtNativeRate;
  }

  /** Reads and maps one SFZ file. `layer` puts the whole file under one layer name. */
  async loadInstrument(
    path: string,
    options: { id: InstrumentId; layer?: string },
  ): Promise<SfzInstrument> {
    const parsed = await loadSfz(path, (file) => this.#files.read(file), {
      packId: this.id,
      ...(options.layer !== undefined && { layer: options.layer }),
    });
    this.#own(options.id, parsed.regions);
    return {
      id: options.id,
      regions: new RegionMap(parsed.regions),
      layers: parsed.layers,
      ...(parsed.keyswitchRange && { keyswitchRange: parsed.keyswitchRange }),
      report: parsed.report,
    };
  }

  instrumentsOf(ref: SampleRef): InstrumentId[] {
    return [...(this.#owners.get(ref) ?? [])];
  }

  /** Exact once the file has been fetched; before that, an estimate from its size, else `NaN`. */
  byteLength(ref: SampleRef): number {
    const decoded = this.#decoded.get(ref);
    if (decoded !== undefined) return decoded;
    const path = this.#pathOf(ref);
    const size = path === undefined ? undefined : this.#files.size?.(path);
    const factor = EXPANSION[extension(path ?? '')];
    return size === undefined || factor === undefined ? Number.NaN : size * factor;
  }

  async fetch(ref: SampleRef): Promise<RawSample> {
    const path = this.#pathOf(ref);
    // Only a ref an instrument issued is read: a ref is data from the manager, and the pack is
    // untrusted, so nothing else maps to a file.
    if (path === undefined || !this.#owners.has(ref)) throw new Error(`Unknown sample ${ref}`);
    // Pack files are untrusted: bound what one can allocate, before the read, before the decode
    // (by the size its header declares) and after it.
    const size = this.#files.size?.(path);
    if (size !== undefined && size > SAMPLE_LIMITS.fileBytes) throw tooBig(ref, 'file', size);
    const bytes = await this.#files.read(path);
    if (bytes.length > SAMPLE_LIMITS.fileBytes) throw tooBig(ref, 'file', bytes.length);
    const header = sniffSampleHeader(bytes);
    if (header.frames === undefined && header.format === 'flac') {
      throw new Error(`Sample ${ref} declares no length, so its decoded size cannot be bounded`);
    }
    if (header.frames !== undefined) {
      const declared = header.frames * header.channels * Float32Array.BYTES_PER_ELEMENT;
      if (declared > SAMPLE_LIMITS.decodedBytes)
        throw tooBig(ref, 'declared decoded size', declared);
    }
    const buffer = await this.#decode(bytes, header.sampleRate);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel),
    );
    const byteLength = buffer.numberOfChannels * buffer.length * Float32Array.BYTES_PER_ELEMENT;
    if (byteLength > SAMPLE_LIMITS.decodedBytes) throw tooBig(ref, 'decoded size', byteLength);
    this.#decoded.set(ref, byteLength);
    return { sampleRate: buffer.sampleRate, channels, byteLength };
  }

  #pathOf(ref: SampleRef): string | undefined {
    if (!ref.startsWith(this.#prefix)) return undefined;
    return resolvePath('', ref.slice(this.#prefix.length));
  }

  #own(id: InstrumentId, regions: readonly { sample: SampleRef }[]): void {
    for (const { sample } of regions) {
      let owners = this.#owners.get(sample);
      if (!owners) {
        owners = new Set();
        this.#owners.set(sample, owners);
      }
      owners.add(id);
    }
  }
}

import { RegionMap, type SampleRef } from '../sampler/region-map';
import { parseSf2, type Sf2File, type Sf2Info, type Sf2Pcm, type Sf2Preset } from './parse';
import type { InstrumentId, RawSample, SampleProvider } from '../samples/types';
import {
  presetRefs,
  resolveInstrument,
  resolvePreset,
  type ResolvedInstrument,
  type ResolvedPreset,
} from './resolve';
import { parseSampleRef } from './sample-ref';

export const PERCUSSION_BANK = 128;

export interface Sf2SoundfontOptions {
  /** Prefix of every instrument id and sample ref, so two soundfonts never share one. No slash. */
  id?: string;
}

export interface PresetSummary {
  id: InstrumentId;
  name: string;
  bank: number;
  program: number;
}

function convert(pcm: Sf2Pcm, start: number, length: number): Float32Array {
  const view = new DataView(pcm.bytes.buffer, pcm.bytes.byteOffset, pcm.bytes.byteLength);
  const out = new Float32Array(length);
  const smpl = pcm.smplOffset + start * 2;
  const sm24 = pcm.sm24Offset;
  if (sm24 === undefined) {
    for (let i = 0; i < length; i += 1) out[i] = view.getInt16(smpl + i * 2, true) / 32_768;
  } else {
    // sm24 holds the low byte under each 16-bit word: (word << 8 | byte) is a signed 24-bit value.
    for (let i = 0; i < length; i += 1) {
      const word = view.getInt16(smpl + i * 2, true);
      out[i] = (word * 256 + view.getUint8(sm24 + start + i)) / 8_388_608;
    }
  }
  return out;
}

/**
 * A parsed SoundFont 2 bank. Parsing reads headers only; PCM stays in the file bytes until
 * `fetch` converts one sample, and presets resolve to regions on first request.
 */
export class Sf2Soundfont implements SampleProvider {
  readonly info: Sf2Info;
  readonly presets: readonly PresetSummary[];
  readonly #file: Sf2File;
  readonly #prefix: string;
  readonly #byKey = new Map<string, Sf2Preset>();
  readonly #instruments = new Map<number, ResolvedInstrument>();
  readonly #resolved = new Map<string, ResolvedPreset>();
  readonly #maps = new Map<string, RegionMap>();
  #usage: Map<SampleRef, InstrumentId[]> | undefined;

  constructor(file: Sf2File, options: Sf2SoundfontOptions = {}) {
    this.#file = file;
    this.#prefix = options.id ?? 'gm';
    if (!this.#prefix || this.#prefix.includes('/')) {
      throw new Error(
        `Soundfont id ${JSON.stringify(this.#prefix)} must be non-empty without a slash`,
      );
    }
    this.info = file.info;
    const presets: PresetSummary[] = [];
    for (const preset of file.presets) {
      const key = `${String(preset.bank)}:${String(preset.program)}`;
      // A duplicate bank and program is malformed; the first one wins, as in most players.
      if (this.#byKey.has(key)) continue;
      this.#byKey.set(key, preset);
      presets.push({
        id: this.#idOf(preset.bank, preset.program),
        name: preset.name,
        bank: preset.bank,
        program: preset.program,
      });
    }
    this.presets = presets;
  }

  static parse(bytes: ArrayBuffer | Uint8Array, options: Sf2SoundfontOptions = {}): Sf2Soundfont {
    return new Sf2Soundfont(parseSf2(bytes), options);
  }

  #idOf(bank: number, program: number): InstrumentId {
    return bank === PERCUSSION_BANK
      ? `${this.#prefix}:drums:${String(program)}`
      : `${this.#prefix}:${String(bank)}:${String(program)}`;
  }

  #instrument(index: number): ResolvedInstrument | undefined {
    const cached = this.#instruments.get(index);
    if (cached) return cached;
    const instrument = this.#file.instruments[index];
    if (!instrument) return undefined;
    const resolved = resolveInstrument(this.#file, instrument);
    this.#instruments.set(index, resolved);
    return resolved;
  }

  /** The preset at exactly this bank and program, resolved to regions. */
  preset(bank: number, program: number): ResolvedPreset | undefined {
    const key = `${String(bank)}:${String(program)}`;
    const cached = this.#resolved.get(key);
    if (cached) return cached;
    const preset = this.#byKey.get(key);
    if (!preset) return undefined;
    const resolved = resolvePreset(preset, this.#idOf(bank, program), this.#prefix, (index) =>
      this.#instrument(index),
    );
    this.#resolved.set(key, resolved);
    return resolved;
  }

  /**
   * The preset a GM player would choose: the exact one, else the same program in bank 0 (a GS
   * variation bank falls back to its capital tone), and for the percussion bank, kit 0.
   */
  resolve(bank: number, program: number): ResolvedPreset | undefined {
    return (
      this.preset(bank, program) ??
      (bank === PERCUSSION_BANK ? this.preset(PERCUSSION_BANK, 0) : this.preset(0, program))
    );
  }

  regionMapFor(bank: number, program: number): RegionMap | undefined {
    const resolved = this.resolve(bank, program);
    if (!resolved) return undefined;
    let map = this.#maps.get(resolved.id);
    if (!map) {
      map = new RegionMap(resolved.regions);
      this.#maps.set(resolved.id, map);
    }
    return map;
  }

  /** A drum kit in bank 128, keyed by MIDI note; kit 0 is the GM standard kit. */
  drumKitRegionMap(kit = 0): RegionMap | undefined {
    return this.regionMapFor(PERCUSSION_BANK, kit);
  }

  /**
   * Every preset of the bank whose regions play the slice. The index is built once from the
   * instruments' zones, which a preset cannot change, so it never resolves a preset's regions.
   */
  instrumentsOf(ref: SampleRef): InstrumentId[] {
    this.#usage ??= this.#index();
    return [...(this.#usage.get(ref) ?? [])];
  }

  #index(): Map<SampleRef, InstrumentId[]> {
    const usage = new Map<SampleRef, InstrumentId[]>();
    for (const preset of this.#byKey.values()) {
      const id = this.#idOf(preset.bank, preset.program);
      for (const ref of presetRefs(preset, this.#prefix, (index) => this.#instrument(index))) {
        const ids = usage.get(ref);
        if (ids) ids.push(id);
        else usage.set(ref, [id]);
      }
    }
    return usage;
  }

  byteLength(ref: SampleRef): number {
    const slice = parseSampleRef(ref);
    return (slice.end - slice.start) * slice.samples.length * Float32Array.BYTES_PER_ELEMENT;
  }

  fetch(ref: SampleRef): Promise<RawSample> {
    try {
      return Promise.resolve(this.#read(ref));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #read(ref: SampleRef): RawSample {
    const slice = parseSampleRef(ref);
    if (slice.soundfont !== this.#prefix) {
      throw new Error(`Sample ${ref} was not issued by soundfont ${this.#prefix}`);
    }
    const [first] = slice.samples;
    const head = first === undefined ? undefined : this.#file.samples[first];
    if (!head) throw new Error(`Sample ${ref} names no sample header`);
    const { pcm } = this.#file;
    const length = slice.end - slice.start;
    if (slice.start < 0 || length <= 0 || slice.end > pcm.frames) {
      throw new Error(`Sample ${ref} lies outside the sample data`);
    }
    const channels = slice.samples.map((index) => {
      const header = this.#file.samples[index];
      if (!header) throw new Error(`Sample ${ref} names no sample header ${String(index)}`);
      // A stereo partner plays the same span relative to its own start as the first channel.
      const start = header.start + (slice.start - head.start);
      if (start < 0 || start + length > pcm.frames) {
        throw new Error(`Sample ${ref} channel ${String(index)} lies outside the sample data`);
      }
      return convert(pcm, start, length);
    });
    return {
      sampleRate: head.sampleRate,
      channels,
      byteLength: length * channels.length * Float32Array.BYTES_PER_ELEMENT,
    };
  }
}

import type { SampleRef } from '../sampler/region-map';

export type InstrumentId = string;

export interface MemoryReport {
  decodedBytes: number;
  budgetBytes: number;
  residents: InstrumentId[];
  /** Residents the loaded song does not plan: what `unloadUnused` frees. */
  unused: InstrumentId[];
  /**
   * An instrument the song uses was evicted and is not resident again, so the budget is below
   * the song's needs and some notes may start late. A raise that restores them clears it.
   */
  shortfall: boolean;
}

export interface RawSample {
  sampleRate: number;
  channels: Float32Array[];
  byteLength: number;
}
export interface SampleProvider {
  instrumentsOf(ref: SampleRef): InstrumentId[]; // every instrument that references a sample; presets share samples
  fetch(ref: SampleRef): Promise<RawSample>; // raw PCM, decoded by the manager into an AudioBuffer
  byteLength(ref: SampleRef): number; // decoded size estimate for budgeting before fetch
}

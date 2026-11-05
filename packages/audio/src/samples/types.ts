import type { SampleRef } from '../sampler/region-map';

export type InstrumentId = string; // e.g. 'gm:0:25' = bank:program, 'gm:drums:0' for kits
export interface RawSample {
  sampleRate: number;
  channels: Float32Array[];
  loop?: { start: number; end: number };
  byteLength: number;
}
export interface SampleProvider {
  instrumentOf(ref: SampleRef): InstrumentId; // which instrument a sample belongs to, for whole-instrument eviction
  fetch(ref: SampleRef): Promise<RawSample>; // raw PCM, decoded by the manager into an AudioBuffer
  byteLength(ref: SampleRef): number; // decoded size estimate for budgeting before fetch
}

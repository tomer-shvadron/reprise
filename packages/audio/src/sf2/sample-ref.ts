import type { SampleRef } from '../sampler/region-map';

/**
 * Everything `fetch` needs, carried in the ref itself so the provider keeps no table of issued
 * refs: the soundfont, the `shdr` index of each channel and the frame span after the zone's
 * address offsets. The slice is the PCM alone, so every zone of every preset that plays the same
 * span, whatever its loop or tuning, shares one ref and the memory manager decodes it once.
 */
export interface SampleSlice {
  /** The `Sf2Soundfont` id; two banks never issue the same ref. */
  soundfont: string;
  /** `shdr` indices: one for mono, left then right for a merged stereo pair. */
  samples: readonly number[];
  /** Absolute frames into `smpl` for the first channel, end exclusive. */
  start: number;
  end: number;
}

export function formatSampleRef(slice: SampleSlice): SampleRef {
  return `${slice.soundfont}/${slice.samples.join('+')}/${String(slice.start)}-${String(slice.end)}`;
}

const REF = /^([^/]+)\/(\d+(?:\+\d+)?)\/(\d+)-(\d+)$/;

export function parseSampleRef(ref: SampleRef): SampleSlice {
  const match = REF.exec(ref);
  const soundfont = match?.[1];
  const samples = match?.[2];
  const start = match?.[3];
  const end = match?.[4];
  if (!soundfont || !samples || start === undefined || end === undefined) {
    throw new Error(`Not an SF2 sample ref: ${ref}`);
  }
  return {
    soundfont,
    samples: samples.split('+').map(Number),
    start: Number(start),
    end: Number(end),
  };
}

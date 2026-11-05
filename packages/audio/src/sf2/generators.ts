/** SF2 2.04 generator operators (section 8.1.2), the ones the loader reads or reports. */
export const Gen = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  modLfoToPitch: 5,
  vibLfoToPitch: 6,
  modEnvToPitch: 7,
  initialFilterFc: 8,
  initialFilterQ: 9,
  modLfoToFilterFc: 10,
  modEnvToFilterFc: 11,
  endAddrsCoarseOffset: 12,
  modLfoToVolume: 13,
  chorusEffectsSend: 15,
  reverbEffectsSend: 16,
  pan: 17,
  sustainModEnv: 29,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keynumToVolEnvHold: 39,
  keynumToVolEnvDecay: 40,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  keynum: 46,
  velocity: 47,
  initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
} as const;

/** Generators whose amount is two bytes, lo and hi, rather than one signed word. */
export const RANGE_GENERATORS: ReadonlySet<number> = new Set([Gen.keyRange, Gen.velRange]);

/**
 * Generators a preset zone may not carry (8.5): sample addresses and the per-zone fixed values
 * are instrument-level only, and a preset-level occurrence is ignored rather than added.
 */
export const INSTRUMENT_ONLY: ReadonlySet<number> = new Set([
  Gen.startAddrsOffset,
  Gen.endAddrsOffset,
  Gen.startloopAddrsOffset,
  Gen.endloopAddrsOffset,
  Gen.startAddrsCoarseOffset,
  Gen.endAddrsCoarseOffset,
  Gen.startloopAddrsCoarseOffset,
  Gen.endloopAddrsCoarseOffset,
  Gen.keynum,
  Gen.velocity,
  Gen.sampleModes,
  Gen.exclusiveClass,
  Gen.overridingRootKey,
]);

/** Spec defaults (8.1.3) for every generator whose default is not 0. */
const DEFAULTS: ReadonlyMap<number, number> = new Map([
  [Gen.initialFilterFc, 13_500],
  [Gen.delayVolEnv, -12_000],
  [Gen.attackVolEnv, -12_000],
  [Gen.holdVolEnv, -12_000],
  [Gen.decayVolEnv, -12_000],
  [Gen.releaseVolEnv, -12_000],
  [Gen.keynum, -1],
  [Gen.velocity, -1],
  [Gen.scaleTuning, 100],
  [Gen.overridingRootKey, -1],
]);

export function defaultOf(generator: number): number {
  return DEFAULTS.get(generator) ?? 0;
}

/** Legal ranges (8.1.3); a sum of instrument value and preset offset is clamped into them. */
const LIMITS: ReadonlyMap<number, readonly [number, number]> = new Map([
  [Gen.modEnvToPitch, [-12_000, 12_000]],
  [Gen.pan, [-500, 500]],
  [Gen.sustainModEnv, [0, 1000]],
  [Gen.delayVolEnv, [-12_000, 5000]],
  [Gen.attackVolEnv, [-12_000, 8000]],
  [Gen.holdVolEnv, [-12_000, 5000]],
  [Gen.decayVolEnv, [-12_000, 8000]],
  [Gen.sustainVolEnv, [0, 1440]],
  [Gen.releaseVolEnv, [-12_000, 8000]],
  [Gen.keynumToVolEnvHold, [-1200, 1200]],
  [Gen.keynumToVolEnvDecay, [-1200, 1200]],
  [Gen.initialAttenuation, [0, 1440]],
  [Gen.coarseTune, [-120, 120]],
  [Gen.fineTune, [-99, 99]],
  [Gen.scaleTuning, [0, 1200]],
]);

export function clampGenerator(generator: number, value: number): number {
  const limits = LIMITS.get(generator);
  return limits ? Math.min(limits[1], Math.max(limits[0], value)) : value;
}

/**
 * Generators the `Region` cannot carry, with the value at which each has no effect. A resolved
 * zone holding anything else is counted in the preset's report, never approximated. The one
 * split case is `modEnvToPitch`: the share the envelope holds at its sustain level is a fixed
 * pitch offset and goes to `tune`; what is counted here is the transient the voice cannot play.
 */
export const UNSUPPORTED: ReadonlyMap<number, { name: string; neutral: number }> = new Map([
  [Gen.modLfoToPitch, { name: 'modLfoToPitch', neutral: 0 }],
  [Gen.vibLfoToPitch, { name: 'vibLfoToPitch', neutral: 0 }],
  [Gen.modEnvToPitch, { name: 'modEnvToPitch', neutral: 0 }],
  [Gen.initialFilterFc, { name: 'initialFilterFc', neutral: 13_500 }],
  [Gen.initialFilterQ, { name: 'initialFilterQ', neutral: 0 }],
  [Gen.modLfoToFilterFc, { name: 'modLfoToFilterFc', neutral: 0 }],
  [Gen.modEnvToFilterFc, { name: 'modEnvToFilterFc', neutral: 0 }],
  [Gen.modLfoToVolume, { name: 'modLfoToVolume', neutral: 0 }],
  [Gen.chorusEffectsSend, { name: 'chorusEffectsSend', neutral: 0 }],
  [Gen.reverbEffectsSend, { name: 'reverbEffectsSend', neutral: 0 }],
  [Gen.delayVolEnv, { name: 'delayVolEnv', neutral: -12_000 }],
  [Gen.keynum, { name: 'keynum', neutral: -1 }],
  [Gen.velocity, { name: 'velocity', neutral: -1 }],
  [Gen.exclusiveClass, { name: 'exclusiveClass', neutral: 0 }],
]);

/** Absolute timecents to seconds; -12000, the spec's floor, is about a millisecond. */
export function timecentsToSeconds(timecents: number): number {
  return 2 ** (timecents / 1200);
}

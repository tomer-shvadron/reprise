import type { Envelope, Region, SampleRef } from '../sampler/region-map';
import {
  Gen,
  INSTRUMENT_ONLY,
  UNSUPPORTED,
  clampGenerator,
  defaultOf,
  timecentsToSeconds,
} from './generators';
import {
  SampleType,
  type Sf2File,
  type Sf2Instrument,
  type Sf2Preset,
  type Sf2Sample,
  type Sf2Zone,
} from './parse';
import type { InstrumentId } from '../samples/types';
import { formatSampleRef } from './sample-ref';

/** What resolving a preset could not carry into its regions; counts are of resolved zones. */
export interface PresetReport {
  /** Generators the `Region` has no field for, by name, wherever a zone sets a non-neutral value. */
  unsupported: Record<string, number>;
  /** Zones under at least one modulator beyond the defaults; none is applied. */
  modulated: number;
  /** Zones expanded to one region per key for `keynumToVolEnv*` or a `scaleTuning` other than 100. */
  keyExpanded: number;
  /** Stereo pairs whose right zone differs from the left in a non-pitch generator the merge drops. */
  stereoMismatches: number;
  /**
   * Stereo halves played as mono regions, panned by their own zone, because the partner zone
   * covers other keys or velocities or its span lies outside the sample data.
   */
  unpairedStereo: number;
  /**
   * Region pairs that overlap in key and velocity, so a key-expanded zone counts once per key.
   * SF2 sounds both, the sampler the first.
   */
  layered: number;
  /** Zones dropped for a ROM or missing sample, or a sample rate that is not positive. */
  skippedZones: number;
  /**
   * Loops dropped, so the zone plays once: a loop outside the sample, or one that starts before
   * the zone's start offset, which SF2 allows but a buffer sliced at that offset cannot hold.
   */
  invalidLoops: number;
}

export interface ResolvedPreset {
  id: InstrumentId;
  name: string;
  bank: number;
  program: number;
  regions: Region[];
  /** Decoded Float32 size of every distinct sample the regions use. */
  bytes: number;
  report: PresetReport;
}

interface Range {
  lo: number;
  hi: number;
}

/**
 * One instrument zone after its global merge and stereo pairing: the part of a region that every
 * preset using the instrument shares, since a preset cannot change a zone's sample, addresses or
 * loop (8.5). `pitch` is the zone whose pitch generators and header apply: for a linked pair the
 * right one (7.10), otherwise the zone itself.
 */
export interface InstrumentZone {
  generators: ReadonlyMap<number, number>;
  pitch: { generators: ReadonlyMap<number, number>; sample: Sf2Sample };
  key: Range;
  vel: Range;
  sample: Sf2Sample;
  /** `shdr` indices: one for mono, left then right for a merged pair. */
  samples: readonly number[];
  /** Absolute frames into `smpl`, end exclusive, after the address offsets. */
  start: number;
  end: number;
  loop?: { start: number; end: number };
  invalidLoop: boolean;
  modulated: boolean;
  mismatch: boolean;
  unpaired: boolean;
}

export interface ResolvedInstrument {
  zones: InstrumentZone[];
  /** Zones dropped for a ROM or missing sample, or a sample rate that is not positive. */
  skipped: number;
}

const FULL_RANGE = 127 << 8;
/** The sampler's exponential ramps stop at -80 dB; SF2 times are for a 100 dB fall (8.1.3). */
const SAMPLER_FLOOR_DB = 80;
const SF2_FULL_SCALE_DB = 100;

function range(amount: number | undefined): Range {
  const value = amount ?? FULL_RANGE;
  return { lo: value & 0xff, hi: value >> 8 };
}

function sameRange(a: Range, b: Range): boolean {
  return a.lo === b.lo && a.hi === b.hi;
}

function intersect(a: Range, b: Range): Range | undefined {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi, 127);
  return lo <= hi ? { lo, hi } : undefined;
}

/** A local zone's generators replace its global zone's, operator by operator (9.4, 9.6). */
function withGlobal(global: Sf2Zone | undefined, zone: Sf2Zone): Map<number, number> {
  return new Map([...(global?.generators ?? []), ...zone.generators]);
}

/** Preset generators are offsets added to the instrument's (9.4); ranges intersect instead. */
function withOffsets(
  base: ReadonlyMap<number, number>,
  preset: ReadonlyMap<number, number>,
): Map<number, number> {
  const generators = new Map(base);
  for (const [operator, amount] of preset) {
    if (INSTRUMENT_ONLY.has(operator) || operator === Gen.keyRange) continue;
    if (operator === Gen.velRange || operator === Gen.instrument) continue;
    generators.set(operator, (generators.get(operator) ?? defaultOf(operator)) + amount);
  }
  return generators;
}

function value(generators: ReadonlyMap<number, number>, operator: number): number {
  return clampGenerator(operator, generators.get(operator) ?? defaultOf(operator));
}

function address(generators: ReadonlyMap<number, number>, fine: number, coarse: number): number {
  return (generators.get(fine) ?? 0) + 32_768 * (generators.get(coarse) ?? 0);
}

interface Slice {
  start: number;
  end: number;
  loop?: { start: number; end: number };
  invalidLoop: boolean;
}

function sliceOf(
  generators: ReadonlyMap<number, number>,
  sample: Sf2Sample,
  frames: number,
): Slice {
  const start = Math.min(
    frames - 1,
    Math.max(
      0,
      sample.start + address(generators, Gen.startAddrsOffset, Gen.startAddrsCoarseOffset),
    ),
  );
  const end = Math.min(
    frames,
    Math.max(
      start + 1,
      sample.end + address(generators, Gen.endAddrsOffset, Gen.endAddrsCoarseOffset),
    ),
  );
  const loopStart =
    sample.loopStart +
    address(generators, Gen.startloopAddrsOffset, Gen.startloopAddrsCoarseOffset);
  const loopEnd =
    sample.loopEnd + address(generators, Gen.endloopAddrsOffset, Gen.endloopAddrsCoarseOffset);
  // Mode 1 loops; mode 3 loops until release, which a plain loop plus the release covers. 2 is
  // reserved and plays unlooped, as 0 does.
  const mode = value(generators, Gen.sampleModes) & 3;
  if (mode !== 1 && mode !== 3) return { start, end, invalidLoop: false };
  if (loopStart >= start && loopEnd <= end && loopEnd > loopStart) {
    return { start, end, loop: { start: loopStart, end: loopEnd }, invalidLoop: false };
  }
  return { start, end, invalidLoop: true };
}

interface Entry {
  generators: Map<number, number>;
  index: number;
  sample: Sf2Sample;
  key: Range;
  vel: Range;
  modulated: boolean;
}

/** Generators the stereo merge reads from the left zone alone; a differing right zone is reported. */
const PAIR_CHECKED = [
  Gen.attackVolEnv,
  Gen.holdVolEnv,
  Gen.decayVolEnv,
  Gen.sustainVolEnv,
  Gen.releaseVolEnv,
  Gen.keynumToVolEnvHold,
  Gen.keynumToVolEnvDecay,
  Gen.initialAttenuation,
  Gen.sampleModes,
];

function isStereo(sample: Sf2Sample): boolean {
  return (sample.type & (SampleType.left | SampleType.right)) !== 0;
}

function isRight(sample: Sf2Sample): boolean {
  return (sample.type & SampleType.right) !== 0;
}

/** The right channel reads the left's span at the same offset from its own start; it must fit. */
function partnerFits(left: Entry, right: Entry, frames: number): boolean {
  const slice = sliceOf(left.generators, left.sample, frames);
  const start = right.sample.start + (slice.start - left.sample.start);
  return start >= 0 && start + (slice.end - slice.start) <= frames;
}

/**
 * Merges each left/right zone pair into one zone with both samples, left first, so a note plays
 * one two-channel region. Partners must name each other's sample and cover the same keys and
 * velocities; the pair's pitch follows the right zone (7.10), everything else the left.
 */
function pairStereo(file: Sf2File, entries: Entry[]): InstrumentZone[] {
  const frames = file.pcm.frames;
  const zones: InstrumentZone[] = [];
  const used = new Set<Entry>();
  for (const entry of entries) {
    if (used.has(entry)) continue;
    used.add(entry);
    const stereo = isStereo(entry.sample);
    const partner = stereo
      ? entries.find((other) => {
          if (used.has(other) || other.index !== entry.sample.link) return false;
          if (
            other.sample.link !== entry.index ||
            isRight(other.sample) === isRight(entry.sample)
          ) {
            return false;
          }
          if (!sameRange(other.key, entry.key) || !sameRange(other.vel, entry.vel)) return false;
          return isRight(entry.sample)
            ? partnerFits(other, entry, frames)
            : partnerFits(entry, other, frames);
        })
      : undefined;
    if (!partner) {
      zones.push({
        generators: entry.generators,
        pitch: { generators: entry.generators, sample: entry.sample },
        key: entry.key,
        vel: entry.vel,
        sample: entry.sample,
        samples: [entry.index],
        ...sliceOf(entry.generators, entry.sample, frames),
        modulated: entry.modulated,
        mismatch: false,
        unpaired: stereo,
      });
      continue;
    }
    used.add(partner);
    const [left, right] = isRight(entry.sample) ? [partner, entry] : [entry, partner];
    zones.push({
      generators: left.generators,
      pitch: { generators: right.generators, sample: right.sample },
      key: left.key,
      vel: left.vel,
      sample: left.sample,
      samples: [left.index, right.index],
      ...sliceOf(left.generators, left.sample, frames),
      modulated: left.modulated || right.modulated,
      mismatch: PAIR_CHECKED.some(
        (operator) => left.generators.get(operator) !== right.generators.get(operator),
      ),
      unpaired: false,
    });
  }
  return zones;
}

/** An instrument's zones, resolved once and shared by every preset that names it. */
export function resolveInstrument(file: Sf2File, instrument: Sf2Instrument): ResolvedInstrument {
  const entries: Entry[] = [];
  let skipped = 0;
  for (const zone of instrument.zones) {
    const generators = withGlobal(instrument.global, zone);
    const index = generators.get(Gen.sampleID) ?? -1;
    const sample = file.samples[index];
    if (!sample || (sample.type & SampleType.rom) !== 0 || !(sample.sampleRate > 0)) {
      skipped += 1;
      continue;
    }
    entries.push({
      generators,
      index,
      sample,
      key: range(generators.get(Gen.keyRange)),
      vel: range(generators.get(Gen.velRange)),
      modulated: zone.modulators + (instrument.global?.modulators ?? 0) > 0,
    });
  }
  return { zones: pairStereo(file, entries), skipped };
}

export type InstrumentAt = (index: number) => ResolvedInstrument | undefined;

interface Use {
  zone: InstrumentZone;
  key: Range;
  vel: Range;
  presetGens: Map<number, number>;
  presetModulated: boolean;
}

/** The instrument zones a preset sounds, each under its preset zone, in map order. */
function* uses(
  preset: Sf2Preset,
  instrumentAt: InstrumentAt,
  report?: PresetReport,
): Generator<Use> {
  for (const presetZone of preset.zones) {
    const instrument = instrumentAt(presetZone.generators.get(Gen.instrument) ?? -1);
    if (!instrument) {
      if (report) report.skippedZones += 1;
      continue;
    }
    if (report) report.skippedZones += instrument.skipped;
    const presetGens = withGlobal(preset.global, presetZone);
    const presetKey = range(presetGens.get(Gen.keyRange));
    const presetVel = range(presetGens.get(Gen.velRange));
    const presetModulated = presetZone.modulators + (preset.global?.modulators ?? 0) > 0;
    for (const zone of instrument.zones) {
      const key = intersect(zone.key, presetKey);
      const vel = intersect(zone.vel, presetVel);
      if (key && vel) yield { zone, key, vel, presetGens, presetModulated };
    }
  }
}

function refOf(soundfont: string, zone: InstrumentZone): SampleRef {
  return formatSampleRef({ soundfont, samples: zone.samples, start: zone.start, end: zone.end });
}

/** The refs `resolvePreset` would issue, without building the regions: the `instrumentsOf` index. */
export function presetRefs(
  preset: Sf2Preset,
  soundfont: string,
  instrumentAt: InstrumentAt,
): Set<SampleRef> {
  const refs = new Set<SampleRef>();
  for (const { zone } of uses(preset, instrumentAt)) refs.add(refOf(soundfont, zone));
  return refs;
}

export function resolvePreset(
  preset: Sf2Preset,
  id: InstrumentId,
  soundfont: string,
  instrumentAt: InstrumentAt,
): ResolvedPreset {
  const report: PresetReport = {
    unsupported: {},
    modulated: 0,
    keyExpanded: 0,
    stereoMismatches: 0,
    unpairedStereo: 0,
    layered: 0,
    skippedZones: 0,
    invalidLoops: 0,
  };
  const regions: Region[] = [];
  const bytes = new Map<SampleRef, number>();

  for (const { zone, key, vel, presetGens, presetModulated } of uses(
    preset,
    instrumentAt,
    report,
  )) {
    if (zone.invalidLoop) report.invalidLoops += 1;
    if (zone.mismatch) report.stereoMismatches += 1;
    if (zone.unpaired) report.unpairedStereo += 1;
    if (zone.modulated || presetModulated) report.modulated += 1;
    const generators = withOffsets(zone.generators, presetGens);
    const pitch =
      zone.pitch.generators === zone.generators
        ? generators
        : withOffsets(zone.pitch.generators, presetGens);
    for (const [operator, { name, neutral }] of UNSUPPORTED) {
      if (value(generators, operator) !== neutral) {
        report.unsupported[name] = (report.unsupported[name] ?? 0) + 1;
      }
    }
    const ref = refOf(soundfont, zone);
    const byteLength =
      (zone.end - zone.start) * zone.samples.length * Float32Array.BYTES_PER_ELEMENT;
    for (const region of buildRegions(zone, generators, pitch, key, vel, ref, report)) {
      regions.push(region);
      bytes.set(ref, byteLength);
    }
  }

  report.layered = countLayered(regions);
  let total = 0;
  for (const size of bytes.values()) total += size;
  return {
    id,
    name: preset.name,
    bank: preset.bank,
    program: preset.program,
    regions,
    bytes: total,
    report,
  };
}

function envelope(generators: ReadonlyMap<number, number>, key: number): Envelope {
  const fromMiddleC = 60 - key;
  const holdTc =
    value(generators, Gen.holdVolEnv) + value(generators, Gen.keynumToVolEnvHold) * fromMiddleC;
  const decayTc =
    value(generators, Gen.decayVolEnv) + value(generators, Gen.keynumToVolEnvDecay) * fromMiddleC;
  const sustainCb = value(generators, Gen.sustainVolEnv);
  const sustainDb = sustainCb / 10;
  return {
    attack: timecentsToSeconds(value(generators, Gen.attackVolEnv)),
    hold: timecentsToSeconds(holdTc),
    // SF2 decay and release are the time of a full 100 dB fall at a constant dB rate; the sampler
    // spends its time reaching the sustain level, or -80 dB at most, so the time scales with it.
    decay:
      (timecentsToSeconds(decayTc) * Math.min(sustainDb, SAMPLER_FLOOR_DB)) / SF2_FULL_SCALE_DB,
    sustain: sustainDb >= SF2_FULL_SCALE_DB ? 0 : 10 ** (-sustainDb / 20),
    release:
      (timecentsToSeconds(value(generators, Gen.releaseVolEnv)) * SAMPLER_FLOOR_DB) /
      SF2_FULL_SCALE_DB,
  };
}

function buildRegions(
  zone: InstrumentZone,
  generators: ReadonlyMap<number, number>,
  pitch: ReadonlyMap<number, number>,
  key: Range,
  vel: Range,
  ref: SampleRef,
  report: PresetReport,
): Region[] {
  const header = zone.pitch.sample;
  const overriding = value(pitch, Gen.overridingRootKey);
  // An originalPitch of 255 means "unpitched"; the spec says to treat it as 60.
  const root =
    overriding >= 0 ? overriding : header.originalPitch > 127 ? 60 : header.originalPitch;
  // The modulation envelope rests at its sustain level for the rest of the note, so that share of
  // `modEnvToPitch` is a fixed offset (GeneralUser GS tunes its Ocarina with it); only the
  // transient is lost, and counted as unsupported.
  const held = (1000 - value(pitch, Gen.sustainModEnv)) / 1000;
  const cents =
    value(pitch, Gen.coarseTune) * 100 +
    value(pitch, Gen.fineTune) +
    header.pitchCorrection +
    value(pitch, Gen.modEnvToPitch) * held;
  const scale = value(pitch, Gen.scaleTuning);
  const attenuation = value(generators, Gen.initialAttenuation) / 10;
  const pan = zone.samples.length === 1 ? value(generators, Gen.pan) / 500 : 0;
  const rate = zone.sample.sampleRate;

  const base = {
    velLo: vel.lo,
    velHi: vel.hi,
    sample: ref,
    ...(zone.loop && {
      loop: {
        start: (zone.loop.start - zone.start) / rate,
        end: (zone.loop.end - zone.start) / rate,
      },
    }),
    ...(attenuation !== 0 && { attenuation }),
    ...(pan !== 0 && { pan }),
  };

  // The Region tunes and shapes per range, so per-key generators become one region per key.
  const perKey =
    scale !== 100 ||
    value(generators, Gen.keynumToVolEnvHold) !== 0 ||
    value(generators, Gen.keynumToVolEnvDecay) !== 0;
  if (!perKey) {
    return [
      {
        ...base,
        keyLo: key.lo,
        keyHi: key.hi,
        rootKey: root,
        tune: cents,
        envelope: envelope(generators, 60),
      },
    ];
  }
  report.keyExpanded += 1;
  const regions: Region[] = [];
  for (let k = key.lo; k <= key.hi; k += 1) {
    regions.push({
      ...base,
      keyLo: k,
      keyHi: k,
      rootKey: k,
      tune: scale * (k - root) + cents,
      envelope: envelope(generators, k),
    });
  }
  return regions;
}

function countLayered(regions: readonly Region[]): number {
  let count = 0;
  for (let i = 0; i < regions.length; i += 1) {
    const a = regions[i];
    if (!a) continue;
    for (let j = i + 1; j < regions.length; j += 1) {
      const b = regions[j];
      if (
        b &&
        a.layer === b.layer &&
        a.keyLo <= b.keyHi &&
        b.keyLo <= a.keyHi &&
        a.velLo <= b.velHi &&
        b.velLo <= a.velHi
      ) {
        count += 1;
      }
    }
  }
  return count;
}

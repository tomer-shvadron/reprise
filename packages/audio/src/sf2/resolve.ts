import type { Envelope, Region } from '../sampler/region-map';
import {
  Gen,
  INSTRUMENT_ONLY,
  UNSUPPORTED,
  clampGenerator,
  defaultOf,
  timecentsToSeconds,
} from './generators';
import { SampleType, type Sf2File, type Sf2Preset, type Sf2Sample, type Sf2Zone } from './parse';
import type { InstrumentId } from './provider-types';
import { formatSampleRef } from './sample-ref';

/** What resolving a preset could not carry into its regions; counts are of resolved zones. */
export interface PresetReport {
  /** Generators the `Region` has no field for, by name, wherever a zone sets a non-neutral value. */
  unsupported: Record<string, number>;
  /** Zones under at least one modulator beyond the defaults; none is applied. */
  modulated: number;
  /** Zones expanded to one region per key for `keynumToVolEnv*` or a `scaleTuning` other than 100. */
  keyExpanded: number;
  /** Stereo pairs whose right zone differs from the left in a generator the merge drops. */
  stereoMismatches: number;
  /** Region pairs that overlap in key and velocity; SF2 sounds both, the sampler the first. */
  layered: number;
  /** Zones dropped for a ROM or missing sample. */
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

const FULL_RANGE = 127 << 8;
/** The sampler's exponential ramps stop at -80 dB; SF2 times are for a 100 dB fall (8.1.3). */
const SAMPLER_FLOOR_DB = 80;
const SF2_FULL_SCALE_DB = 100;

interface Range {
  lo: number;
  hi: number;
}

function range(amount: number | undefined): Range {
  const value = amount ?? FULL_RANGE;
  return { lo: value & 0xff, hi: value >> 8 };
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

interface Entry {
  generators: Map<number, number>;
  sample: number;
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
  Gen.initialAttenuation,
  Gen.coarseTune,
  Gen.fineTune,
  Gen.overridingRootKey,
  Gen.sampleModes,
];

function isStereo(sample: Sf2Sample): boolean {
  return (sample.type & (SampleType.left | SampleType.right)) !== 0;
}

export function resolvePreset(file: Sf2File, preset: Sf2Preset, id: InstrumentId): ResolvedPreset {
  const report: PresetReport = {
    unsupported: {},
    modulated: 0,
    keyExpanded: 0,
    stereoMismatches: 0,
    layered: 0,
    skippedZones: 0,
    invalidLoops: 0,
  };
  const regions: Region[] = [];
  const bytes = new Map<string, number>();

  for (const presetZone of preset.zones) {
    const instrument = file.instruments[presetZone.generators.get(Gen.instrument) ?? -1];
    if (!instrument) {
      report.skippedZones += 1;
      continue;
    }
    const presetGens = withGlobal(preset.global, presetZone);
    const presetKey = range(presetGens.get(Gen.keyRange));
    const presetVel = range(presetGens.get(Gen.velRange));
    const presetModulated = presetZone.modulators + (preset.global?.modulators ?? 0) > 0;

    const entries: Entry[] = [];
    for (const zone of instrument.zones) {
      const generators = withGlobal(instrument.global, zone);
      const sampleIndex = generators.get(Gen.sampleID) ?? -1;
      const sample = file.samples[sampleIndex];
      const key = intersect(range(generators.get(Gen.keyRange)), presetKey);
      const vel = intersect(range(generators.get(Gen.velRange)), presetVel);
      if (!key || !vel) continue;
      if (!sample || (sample.type & SampleType.rom) !== 0) {
        report.skippedZones += 1;
        continue;
      }
      // Preset generators are offsets added to the instrument's (9.4); ranges were intersected.
      for (const [operator, amount] of presetGens) {
        if (INSTRUMENT_ONLY.has(operator) || operator === Gen.keyRange) continue;
        if (operator === Gen.velRange || operator === Gen.instrument) continue;
        generators.set(operator, (generators.get(operator) ?? defaultOf(operator)) + amount);
      }
      const modulated =
        presetModulated || zone.modulators + (instrument.global?.modulators ?? 0) > 0;
      entries.push({ generators, sample: sampleIndex, key, vel, modulated });
    }

    for (const group of pairStereo(file, entries, report)) {
      const built = buildRegions(file, id, group, report);
      for (const { region, byteLength } of built) {
        regions.push(region);
        bytes.set(region.sample, byteLength);
      }
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

/**
 * Merges each left/right zone pair into one entry with both samples, left first, so a note
 * plays one two-channel region. Partners must name each other's sample and cover the same keys
 * and velocities; anything else stays a mono region, panned by its own zone.
 */
function pairStereo(file: Sf2File, entries: Entry[], report: PresetReport): Entry[][] {
  const groups: Entry[][] = [];
  const used = new Set<Entry>();
  for (const entry of entries) {
    if (used.has(entry)) continue;
    used.add(entry);
    const sample = file.samples[entry.sample];
    const partner =
      sample && isStereo(sample)
        ? entries.find(
            (other) =>
              !used.has(other) &&
              other.sample === sample.link &&
              file.samples[other.sample]?.link === entry.sample &&
              other.key.lo === entry.key.lo &&
              other.key.hi === entry.key.hi &&
              other.vel.lo === entry.vel.lo &&
              other.vel.hi === entry.vel.hi,
          )
        : undefined;
    if (!sample || !partner) {
      groups.push([entry]);
      continue;
    }
    used.add(partner);
    const pair = (sample.type & SampleType.right) === 0 ? [entry, partner] : [partner, entry];
    const [left, right] = pair;
    if (
      left &&
      right &&
      PAIR_CHECKED.some(
        (operator) => left.generators.get(operator) !== right.generators.get(operator),
      )
    ) {
      report.stereoMismatches += 1;
    }
    groups.push(pair);
  }
  return groups;
}

function value(generators: Map<number, number>, operator: number): number {
  return clampGenerator(operator, generators.get(operator) ?? defaultOf(operator));
}

function envelope(generators: Map<number, number>, key: number): Envelope {
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

function address(generators: Map<number, number>, fine: number, coarse: number): number {
  return (generators.get(fine) ?? 0) + 32_768 * (generators.get(coarse) ?? 0);
}

function buildRegions(
  file: Sf2File,
  id: InstrumentId,
  group: Entry[],
  report: PresetReport,
): { region: Region; byteLength: number }[] {
  const [first] = group;
  if (!first) return [];
  const { generators } = first;
  const sample = file.samples[first.sample];
  if (!sample) return [];

  for (const [operator, { name, neutral }] of UNSUPPORTED) {
    if (value(generators, operator) !== neutral) {
      report.unsupported[name] = (report.unsupported[name] ?? 0) + 1;
    }
  }
  if (group.some((entry) => entry.modulated)) report.modulated += 1;

  const frames = file.pcm.frames;
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
  let loop: { start: number; end: number } | undefined;
  if (mode === 1 || mode === 3) {
    if (loopStart >= start && loopEnd <= end && loopEnd > loopStart) {
      loop = { start: loopStart, end: loopEnd };
    } else {
      report.invalidLoops += 1;
    }
  }

  const samples = group.map((entry) => entry.sample);
  const ref = formatSampleRef({ instrument: id, samples, start, end, ...(loop && { loop }) });
  const byteLength = (end - start) * samples.length * Float32Array.BYTES_PER_ELEMENT;

  const overriding = value(generators, Gen.overridingRootKey);
  // An originalPitch of 255 means "unpitched"; the spec says to treat it as 60.
  const root =
    overriding >= 0 ? overriding : sample.originalPitch > 127 ? 60 : sample.originalPitch;
  const cents =
    value(generators, Gen.coarseTune) * 100 +
    value(generators, Gen.fineTune) +
    sample.pitchCorrection;
  const scale = value(generators, Gen.scaleTuning);
  const attenuation = value(generators, Gen.initialAttenuation) / 10;
  const pan = group.length === 1 ? value(generators, Gen.pan) / 500 : 0;

  const base = {
    velLo: first.vel.lo,
    velHi: first.vel.hi,
    sample: ref,
    ...(loop && {
      loop: {
        start: (loop.start - start) / sample.sampleRate,
        end: (loop.end - start) / sample.sampleRate,
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
        region: {
          ...base,
          keyLo: first.key.lo,
          keyHi: first.key.hi,
          rootKey: root,
          tune: cents,
          envelope: envelope(generators, 60),
        },
        byteLength,
      },
    ];
  }
  report.keyExpanded += 1;
  const result: { region: Region; byteLength: number }[] = [];
  for (let key = first.key.lo; key <= first.key.hi; key += 1) {
    result.push({
      region: {
        ...base,
        keyLo: key,
        keyHi: key,
        rootKey: key,
        tune: scale * (key - root) + cents,
        envelope: envelope(generators, key),
      },
      byteLength,
    });
  }
  return result;
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

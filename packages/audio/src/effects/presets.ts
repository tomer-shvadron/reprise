import type { Track } from '@reprise/model';

import type { DriveCurve } from './curves';
import type { CabinetId } from './impulses';

/** The stages in signal order; `reverb` is the strip's send into the shared bus, not an insert. */
export const EFFECT_STAGES = [
  'input',
  'drive',
  'tone',
  'cabinet',
  'modulation',
  'delay',
  'output',
  'reverb',
] as const;
export type EffectStage = (typeof EFFECT_STAGES)[number];
/** The stages built into a strip's insert. */
export type InlineStage = Exclude<EffectStage, 'reverb'>;
export const INLINE_STAGES: readonly InlineStage[] = EFFECT_STAGES.filter(
  (stage): stage is InlineStage => stage !== 'reverb',
);

/** A preset's stages: one that is absent is bypassed. */
export interface EffectSpec {
  input?: { gainDb: number };
  drive?: { curve: DriveCurve };
  tone?: { lowDb: number; midDb: number; highDb: number };
  cabinet?: { ir: CabinetId };
  /** `rate` in Hz, `depth` in seconds of delay swing, `mix` the wet share, 0 to 1. */
  modulation?: { rate: number; depth: number; mix: number };
  /** `time` in seconds, `feedback` below 0.6, `mix` the wet share. */
  delay?: { time: number; feedback: number; mix: number };
  output?: { gainDb: number };
  /** Send level into the shared reverb bus, after the fader and pan. */
  reverb?: { send: number };
}

export const EFFECT_FAMILIES = [
  'clean',
  'overdrive',
  'distortion',
  'acoustic',
  'bass',
  'keys',
  'drums',
  'other',
] as const;
export type EffectFamily = (typeof EFFECT_FAMILIES)[number];

export const EFFECT_PRESET_IDS = [...EFFECT_FAMILIES, 'fuzz', 'off'] as const;
export type EffectPresetId = (typeof EFFECT_PRESET_IDS)[number];

/**
 * The starting presets. `output` is each chain's makeup gain: `chain.test.ts` pins every preset
 * within 3 dB of its bypassed level at a forte (-26 dBFS RMS) and a mezzo (-31) plucked line, the
 * levels of GM notes, so a chain never pushes a mix into the master limiter. A saturating preset
 * puts out nearly the same level whatever it is fed, so its makeup is set midway between the two.
 */
export const EFFECT_PRESETS: Readonly<Record<EffectPresetId, Readonly<EffectSpec>>> = {
  clean: {
    input: { gainDb: 0 },
    drive: { curve: 'clean' },
    tone: { lowDb: 1, midDb: 0, highDb: 1 },
    cabinet: { ir: 'open-1x12' },
    modulation: { rate: 0.8, depth: 0.002, mix: 0.35 },
    output: { gainDb: -5.5 },
    reverb: { send: 0.12 },
  },
  overdrive: {
    input: { gainDb: 6 },
    drive: { curve: 'overdrive' },
    tone: { lowDb: 2, midDb: 3, highDb: 0 },
    cabinet: { ir: 'closed-2x12' },
    delay: { time: 0.36, feedback: 0.2, mix: 0.12 },
    output: { gainDb: -22 },
    reverb: { send: 0.1 },
  },
  distortion: {
    input: { gainDb: 12 },
    drive: { curve: 'distortion' },
    tone: { lowDb: 0, midDb: -2, highDb: 2 },
    cabinet: { ir: 'closed-4x12' },
    output: { gainDb: -32.6 },
    reverb: { send: 0.08 },
  },
  fuzz: {
    input: { gainDb: 12 },
    drive: { curve: 'fuzz' },
    tone: { lowDb: 0, midDb: 2, highDb: -2 },
    cabinet: { ir: 'closed-4x12' },
    output: { gainDb: -33 },
    reverb: { send: 0.08 },
  },
  acoustic: {
    tone: { lowDb: -2, midDb: 0, highDb: 1 },
    reverb: { send: 0.15 },
  },
  bass: {
    tone: { lowDb: 2, midDb: 0, highDb: -1 },
  },
  keys: { reverb: { send: 0.15 } },
  drums: { reverb: { send: 0.1 } },
  other: { reverb: { send: 0.15 } },
  off: {},
};

/**
 * The family of a track's GM program, from `kind` first (every drum track is `drums`, whatever its
 * kit number), then the program alone: a fretted or pitched track is classified the same way.
 */
export function presetFamilyOf(track: Pick<Track, 'kind' | 'program'>): EffectFamily {
  if (track.kind === 'drums') return 'drums';
  const { program } = track;
  if (program === 29) return 'overdrive';
  if (program === 30) return 'distortion';
  if (program === 24 || program === 25) return 'acoustic';
  if (program === 26 || program === 27 || program === 28 || program === 31) return 'clean';
  if (program >= 32 && program <= 39) return 'bass';
  if (program >= 0 && program <= 23) return 'keys';
  return 'other';
}

export function isEffectPresetId(id: string | undefined): id is EffectPresetId {
  return id !== undefined && (EFFECT_PRESET_IDS as readonly string[]).includes(id);
}

export interface ResolvedEffects {
  /** `undefined` means no chain at all: the GM tier's own sound, untouched. */
  preset: EffectPresetId | undefined;
  /** True when no valid preset was chosen on the track, so the family decided. */
  automatic: boolean;
}

export interface ResolveContext {
  tier: 'gm' | 'hq';
  gmTierBypass: boolean;
}

/**
 * A preset the track names applies on either tier, `off` included. An absent or unknown id is
 * automatic: the family preset on the HQ tier, and on the GM tier unless the GM tier bypass is on
 * (the default), because the soundfont's distorted samples are already processed.
 */
export function resolveEffects(
  track: Pick<Track, 'kind' | 'program' | 'sound'>,
  { tier, gmTierBypass }: ResolveContext,
): ResolvedEffects {
  const chosen = track.sound?.preset;
  if (isEffectPresetId(chosen)) return { preset: chosen, automatic: false };
  if (tier === 'gm' && gmTierBypass) return { preset: undefined, automatic: true };
  return { preset: presetFamilyOf(track), automatic: true };
}

/** The preset's stages less the ones bypassed for the session. */
export function stagesOf(
  preset: EffectPresetId | undefined,
  bypassed: ReadonlySet<EffectStage> = new Set(),
): EffectSpec {
  if (!preset) return {};
  const dropped: readonly string[] = [...bypassed];
  return Object.fromEntries(
    Object.entries(EFFECT_PRESETS[preset]).filter(([stage]) => !dropped.includes(stage)),
  );
}

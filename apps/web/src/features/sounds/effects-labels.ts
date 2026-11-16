import { EFFECT_PRESET_IDS, presetFamilyOf, resolveEffects } from '@reprise/audio';
import type { EffectPresetId } from '@reprise/audio';
import type { Track } from '@reprise/model';

const LABELS: Readonly<Record<EffectPresetId, string>> = {
  clean: 'Clean',
  overdrive: 'Overdrive',
  distortion: 'Distortion',
  fuzz: 'Fuzz',
  acoustic: 'Acoustic',
  bass: 'Bass',
  keys: 'Keys',
  drums: 'Drums',
  other: 'Other',
  off: 'Off',
};

export const presetLabel = (id: EffectPresetId): string => LABELS[id];

/** The presets in picker order: the family presets, then fuzz, then off. */
export const PRESET_CHOICES: readonly EffectPresetId[] = EFFECT_PRESET_IDS;

/** A stored id the engine does not know plays as automatic, so the picker shows it that way. */
export function chosenPreset(track: Pick<Track, 'sound'>): EffectPresetId | undefined {
  const stored = track.sound?.preset;
  return PRESET_CHOICES.find((id) => id === stored);
}

/**
 * What "Automatic" resolves to for the track: its family's preset, or nothing at all on GM sounds
 * while the GM tier bypass is on.
 *
 * `tier` is the track's `playback.trackSounds` tier, which the audio service derives with the
 * audio package's `tierOf`, the rule the engine applies; a track with no entry is GM.
 */
export function automaticLabel(
  track: Track,
  gmTierBypass: boolean,
  tier: 'gm' | 'hq' = 'gm',
): string {
  const { preset } = resolveEffects(
    { kind: track.kind, program: track.program },
    { tier, gmTierBypass },
  );
  return preset === undefined
    ? 'Automatic (off on GM sounds)'
    : `Automatic (${presetLabel(presetFamilyOf(track))})`;
}

import type { ModulatorDestination, ModulatorSource, NoteModulator } from '../sampler/region-map';
import { Gen } from './generators';
import type { Sf2Modulator } from './parse';

const DESTINATIONS: ReadonlyMap<number, ModulatorDestination> = new Map([
  [Gen.initialAttenuation, 'attenuation'],
  [Gen.initialFilterFc, 'filterFc'],
  [Gen.modEnvToFilterFc, 'modEnvToFilterFc'],
  [Gen.initialFilterQ, 'filterQ'],
]);

const CURVES: readonly ModulatorSource['curve'][] = ['linear', 'concave', 'convex', 'switch'];
const LINKED = 0x80_00;
const CONTROLLER_INDEX = 0x7f;
const CONTROL_CHANGE = 0x80;
const NEGATIVE = 0x1_00;
const BIPOLAR = 0x2_00;
const VELOCITY_INDEX = 2;
const KEY_INDEX = 3;

const NONE: ModulatorSource = { input: 'none', curve: 'linear', negative: false, bipolar: false };

/**
 * FluidSynth's default modulators that matter at note-on, the ones GeneralUser GS is voiced
 * against: velocity to attenuation (960 cB, negative concave: the MIDI curve (v/127)^2) and
 * velocity to the cutoff (-2400 cents, negative linear, switched on by velocity 64 and up). The
 * channel-volume, pan and expression modulators stay with the channel strip.
 */
const DEFAULTS: readonly Sf2Modulator[] = [
  {
    source: VELOCITY_INDEX | (1 << 10) | NEGATIVE,
    destination: Gen.initialAttenuation,
    amount: 960,
    amountSource: 0,
    transform: 0,
  },
  {
    source: VELOCITY_INDEX | NEGATIVE,
    destination: Gen.initialFilterFc,
    amount: -2400,
    amountSource: VELOCITY_INDEX | (3 << 10),
    transform: 0,
  },
];

/** The part of a modulator that decides what it overrides or adds to (SF2 2.04 9.5). */
function identity(modulator: Sf2Modulator): string {
  return `${String(modulator.source)}/${String(modulator.destination)}/${String(
    modulator.amountSource,
  )}/${String(modulator.transform)}`;
}

/** One level's list: within it, a later modulator replaces an earlier one with the same identity. */
export function layerModulators(...lists: readonly (readonly Sf2Modulator[])[]): Sf2Modulator[] {
  const byIdentity = new Map<string, Sf2Modulator>();
  for (const list of lists) {
    for (const modulator of list) byIdentity.set(identity(modulator), modulator);
  }
  return [...byIdentity.values()];
}

function decodeSource(raw: number): ModulatorSource | undefined {
  const index = raw & CONTROLLER_INDEX;
  const controlChange = (raw & CONTROL_CHANGE) !== 0;
  if (index === 0 && !controlChange) return NONE;
  if (controlChange || (index !== VELOCITY_INDEX && index !== KEY_INDEX)) return undefined;
  const curve = CURVES[(raw >> 10) & 0x3f];
  if (!curve) return undefined;
  return {
    input: index === KEY_INDEX ? 'key' : 'velocity',
    curve,
    negative: (raw & NEGATIVE) !== 0,
    bipolar: (raw & BIPOLAR) !== 0,
  };
}

function decode(modulator: Sf2Modulator): NoteModulator | undefined {
  if ((modulator.destination & LINKED) !== 0 || (modulator.transform & ~2) !== 0) return undefined;
  const destination = DESTINATIONS.get(modulator.destination);
  const source = decodeSource(modulator.source);
  const amountSource = decodeSource(modulator.amountSource);
  if (!destination || !source || !amountSource) return undefined;
  return {
    destination,
    amount: modulator.amount,
    source,
    amountSource,
    absolute: modulator.transform === 2,
  };
}

export interface MergedModulators {
  /** The note-on modulators to apply, the defaults included; an amount of 0 is dropped. */
  modulators: NoteModulator[];
  /** Modulators the zones set that cannot be applied: CC, pressure and linked sources, other destinations. */
  unapplied: number;
}

/**
 * The modulators a note plays: the defaults, replaced where an instrument-level modulator has the
 * same identity, then offset where a preset-level one has (its amount is added), or extended
 * where it has none (SF2 2.04 9.5, as FluidSynth does). Each argument is one level's list, global
 * zone first, already layered with `layerModulators`.
 */
export function mergeModulators(
  instrument: readonly Sf2Modulator[],
  preset: readonly Sf2Modulator[],
): MergedModulators {
  const merged = new Map<string, Sf2Modulator>();
  for (const modulator of DEFAULTS) merged.set(identity(modulator), modulator);
  for (const modulator of instrument) merged.set(identity(modulator), modulator);
  for (const modulator of preset) {
    const key = identity(modulator);
    const existing = merged.get(key);
    merged.set(
      key,
      existing ? { ...existing, amount: existing.amount + modulator.amount } : modulator,
    );
  }
  const modulators: NoteModulator[] = [];
  let unapplied = 0;
  for (const modulator of merged.values()) {
    const decoded = decode(modulator);
    if (!decoded) unapplied += 1;
    else if (decoded.amount !== 0) modulators.push(decoded);
  }
  return { modulators, unapplied };
}

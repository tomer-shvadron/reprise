import type { BeatEffects, Note, Track } from '@reprise/model';

import type { Instrument } from '../sampler/sampler';
import type { InstrumentId } from '../samples/types';

/**
 * The articulation vocabulary a sample pack can declare, and the keys of `PackAssignment.entries`:
 * `entries.<set>` is an SFZ file in the pack that plays that set, and `default` is required. A
 * key outside this list is ignored. The names are camelCase, like the model's enum values.
 *
 * Slides, bends, vibrato, trills, tremolo, dynamics and fades are not sets: they stay automation
 * in both tiers (ADR-0004).
 */
export const ARTICULATION_SETS = [
  'default',
  'palmMute',
  'dead',
  'harmonic',
  'artificialHarmonic',
  'legato',
  'staccato',
  'tap',
  'slap',
  'pop',
] as const;

export type ArticulationSet = (typeof ARTICULATION_SETS)[number];

/** A word in a label: not inside a longer run of letters, so `pm` matches `PM` but not `pmx`. */
const token = (alternatives: string): RegExp =>
  new RegExp(`(?<![a-z])(?:${alternatives})(?![a-z])`, 'i');

/**
 * First match wins, so `palm mute` is not read as a bare `mute` and `artificial harmonic` is not
 * read as a natural one.
 */
const LABELS: readonly (readonly [ArticulationSet, RegExp])[] = [
  ['artificialHarmonic', token(String.raw`pinch|artificial|a\.?h\.?`)],
  ['palmMute', token(String.raw`palm|p\.?m\.?`)],
  ['dead', token(String.raw`dead|x[- ]?notes?|mute[ds]?`)],
  ['harmonic', token(String.raw`harm\w*|n\.?h\.?`)],
  ['legato', token(String.raw`hammer\w*|pull\w*|legato|h\.?o\.?|p\.?o\.?`)],
  ['staccato', token(String.raw`stacc?\w*`)],
  ['tap', token(String.raw`tap\w*`)],
  ['slap', token(String.raw`slap\w*`)],
  ['pop', token(String.raw`pop\w*`)],
  ['default', token(String.raw`sustain\w*|open|normal|default`)],
];

/**
 * The articulation set a keyswitch label (`sw_label`) names, or `undefined` when it names none.
 * A pure matcher; which sets a pack really has is the engine's loading, not this function's.
 */
export function articulationSetOf(name: string): ArticulationSet | undefined {
  // `palmMute`, an entries key, reads as the words it is made of.
  const label = name.trim().replaceAll(/([a-z])([A-Z])/g, '$1 $2');
  for (const [set, pattern] of LABELS) if (pattern.test(label)) return set;
  return undefined;
}

/** How one set sounds on a track: a file of its own, a keyswitch layer, or neither (the default). */
export interface SetVoicing {
  /** The set's own instrument, when its pack declares `entries.<set>`. */
  instrument?: Instrument;
  /** A keyswitch layer of the default instrument (`sw:<k>`), when a labelled one matches. */
  layer?: string;
}

/**
 * What the sampler sink knows of a track's sample pack: the sets it has, and whether its default
 * map has `trigger=legato` regions (then a hammer-on starts them, `RegionSelection.legato`). A
 * track on General MIDI has no voicing, and the sink then plays exactly as it did before.
 */
export interface Voicing {
  sets: Partial<Record<ArticulationSet, SetVoicing>>;
  legatoTrigger?: boolean;
}

/** The keyswitch layer of each labelled set in a parsed file (`SfzLayer`): the first label that names a set wins. */
export function setsOfLayers(
  layers: readonly { id: string; label?: string }[],
): Partial<Record<ArticulationSet, SetVoicing>> {
  const sets: Partial<Record<ArticulationSet, SetVoicing>> = {};
  for (const layer of layers) {
    const set = layer.label === undefined ? undefined : articulationSetOf(layer.label);
    // The default layer is the file's own default, whatever its label says.
    if (set === undefined || set === 'default' || sets[set]) continue;
    sets[set] = { layer: layer.id };
  }
  return sets;
}

/** The sets of a voicing table, cached on the table: the sink asks once per note. */
const AVAILABLE = new WeakMap<object, ReadonlySet<ArticulationSet>>();
export function availableSets(
  sets: Partial<Record<ArticulationSet, unknown>>,
): ReadonlySet<ArticulationSet> {
  let available = AVAILABLE.get(sets);
  if (!available) {
    available = new Set(ARTICULATION_SETS.filter((set) => sets[set] !== undefined));
    AVAILABLE.set(sets, available);
  }
  return available;
}

/**
 * Where a track's planner finds each set: the id of its own instrument, or a layer of the default
 * one. The planner's mirror of `Voicing.sets`, which holds sampler instruments.
 */
export type PlanVoicing = Partial<
  Record<ArticulationSet, { instrument?: InstrumentId; layer?: string }>
>;

/** The WP-033 automations a set's own samples already carry, so the planner leaves them out. */
export type SampledEffect = 'palmMute' | 'dead' | 'harmonic' | 'legato';

export interface VoicingInput {
  kind: Track['kind'];
  note: Partial<Pick<Note, 'palmMute' | 'dead' | 'harmonic' | 'hammerPull' | 'staccato'>>;
  /** The beat's effects; a grace note has none of its own. */
  effects: Pick<BeatEffects, 'tapping' | 'slapping' | 'popping'>;
}

export interface NoteVoicing {
  /** The set that plays the note; `default` when the pack has none for it. */
  set: ArticulationSet;
  /** The effects the chosen set's samples carry, whose synthesized automation is dropped. */
  sampled: ReadonlySet<SampledEffect>;
}

const NONE: ReadonlySet<SampledEffect> = new Set();
const SAMPLED: Readonly<Partial<Record<ArticulationSet, SampledEffect>>> = {
  palmMute: 'palmMute',
  dead: 'dead',
  harmonic: 'harmonic',
  artificialHarmonic: 'harmonic',
  legato: 'legato',
};

/**
 * The one rule that says which set plays a note, shared by the sink (playback) and the planner
 * (what to keep in memory). One set per strike, as keyswitches are exclusive, by priority: dead,
 * harmonic, palm mute, staccato, legato or tap, slap, pop. Each effect has a fallback chain
 * (an artificial harmonic to the natural one, a tap to a legato); the first effect whose chain
 * reaches a set the pack has wins, and an effect that loses keeps its synthesized automation on
 * top. Drum tracks and packs without sets (`available` empty, as in General MIDI) play `default`
 * and drop nothing.
 */
export function voicingOf(
  input: VoicingInput,
  available: ReadonlySet<ArticulationSet>,
): NoteVoicing {
  if (available.size === 0 || input.kind === 'drums') return { set: 'default', sampled: NONE };
  const { note, effects } = input;
  // A dead note without a dead set is the noise burst, which no other set's sample replaces.
  if (note.dead && !available.has('dead')) return { set: 'default', sampled: NONE };
  const wanted: (readonly ArticulationSet[])[] = [];
  if (note.dead) wanted.push(['dead']);
  if (note.harmonic) {
    wanted.push(
      note.harmonic.kind === 'natural' ? ['harmonic'] : ['artificialHarmonic', 'harmonic'],
    );
  }
  if (note.palmMute) wanted.push(['palmMute']);
  if (note.staccato) wanted.push(['staccato']);
  if (effects.tapping) wanted.push(['tap', 'legato']);
  if (note.hammerPull) wanted.push(['legato']);
  if (effects.slapping) wanted.push(['slap']);
  if (effects.popping) wanted.push(['pop']);
  for (const chain of wanted) {
    const set = chain.find((candidate) => available.has(candidate));
    if (set === undefined) continue;
    const effect = SAMPLED[set];
    return { set, sampled: effect === undefined ? NONE : new Set([effect]) };
  }
  return { set: 'default', sampled: NONE };
}

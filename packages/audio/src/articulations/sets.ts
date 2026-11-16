import type { Instrument } from '../sampler/sampler';

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

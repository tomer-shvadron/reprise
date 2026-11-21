/** A weight per scale degree, tonic first, for one mode. */
export type Profile = readonly number[];

export interface ProfileSet {
  id: 'krumhanslKessler' | 'temperley' | 'albrechtShanahan';
  name: string;
  /** Where the numbers come from. */
  citation: string;
  major: Profile;
  minor: Profile;
}

// Sources of the numbers, each checked against the published table by the PR 1 review:
// Krumhansl–Kessler is music21's analysis/discrete.py (BSD-3) and When-in-Rome's
// key_profiles_literature.py; Temperley 1999 is Essentia's key.cpp and amads pitch/key/profiles.py;
// Albrecht–Shanahan is When-in-Rome and justkeydding's keyprofile.cc. music21 tabulates only
// Krumhansl–Kessler: its `temperley` entry is the Temperley–Kostka–Payne corpus profile, a different
// set (0.748, 0.060, ...), and it has no Albrecht–Shanahan. Do not "check against music21" for those.
export const PROFILE_SETS: readonly ProfileSet[] = [
  {
    id: 'krumhanslKessler',
    name: 'Krumhansl–Kessler',
    citation:
      'Krumhansl & Kessler (1982), "Tracing the dynamic changes in perceived tonal organization in a spatial representation of musical keys", Psychological Review 89(4); probe-tone ratings.',
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  },
  {
    id: 'temperley',
    name: 'Temperley',
    citation:
      'Temperley (1999), "What\'s key for key? The Krumhansl–Schmuckler key-finding algorithm reconsidered", Music Perception 17(1); the revised profiles.',
    major: [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0],
    minor: [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0],
  },
  {
    id: 'albrechtShanahan',
    name: 'Albrecht–Shanahan',
    citation:
      'Albrecht & Shanahan (2013), "The use of large corpora to train a new type of key-finding algorithm", Music Perception 31(1), 59–67; trained on 490 pieces and tested on a reserve set of 492.',
    major: [0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.08, 0.008, 0.081],
    minor: [0.22, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052],
  },
];

export function profileSetOf(id: ProfileSet['id']): ProfileSet {
  const found = PROFILE_SETS.find((set) => set.id === id);
  if (!found) throw new RangeError(`unknown profile set ${id}`);
  return found;
}

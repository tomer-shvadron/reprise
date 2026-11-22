import type { Drone } from './track';

export type TuningInstrument =
  | 'guitar'
  | 'bass'
  | 'ukulele'
  | 'banjo'
  | 'mandolin'
  | 'twelveString'
  | 'violin'
  | 'viola'
  | 'cello'
  | 'doubleBass'
  | 'shamisen'
  | 'mandola'
  | 'octaveMandolin';

export interface NamedTuning {
  name: string;
  instrument: TuningInstrument;
  /** Open-string MIDI notes in `Track.tuning` order: the lowest (string N) first. */
  strings: readonly number[];
  /** `Track.courses` for the preset; absent means every string is single. */
  courses?: readonly (number | null)[];
  /** `Track.drone` for the preset; absent means none. */
  drone?: Drone;
}

const BANJO_DRONE: Drone = { string: 5, fret: 5 };

export const STANDARD_TUNINGS: readonly NamedTuning[] = [
  { name: 'E standard', instrument: 'guitar', strings: [40, 45, 50, 55, 59, 64] },
  { name: 'Drop D', instrument: 'guitar', strings: [38, 45, 50, 55, 59, 64] },
  { name: 'Eb standard', instrument: 'guitar', strings: [39, 44, 49, 54, 58, 63] },
  { name: 'D standard', instrument: 'guitar', strings: [38, 43, 48, 53, 57, 62] },
  { name: 'Drop C', instrument: 'guitar', strings: [36, 43, 48, 53, 57, 62] },
  { name: 'DADGAD', instrument: 'guitar', strings: [38, 45, 50, 55, 57, 62] },
  { name: 'Open G', instrument: 'guitar', strings: [38, 43, 50, 55, 59, 62] },
  { name: 'Open D', instrument: 'guitar', strings: [38, 45, 50, 54, 57, 62] },
  { name: '7-string standard', instrument: 'guitar', strings: [35, 40, 45, 50, 55, 59, 64] },
  { name: '7-string drop A', instrument: 'guitar', strings: [33, 40, 45, 50, 55, 59, 64] },
  { name: '8-string standard', instrument: 'guitar', strings: [30, 35, 40, 45, 50, 55, 59, 64] },
  { name: 'Bass standard', instrument: 'bass', strings: [28, 33, 38, 43] },
  { name: '5-string bass standard', instrument: 'bass', strings: [23, 28, 33, 38, 43] },
  { name: '6-string bass standard', instrument: 'bass', strings: [23, 28, 33, 38, 43, 48] },
  { name: 'Drop D bass', instrument: 'bass', strings: [26, 33, 38, 43] },
  // Re-entrant: string 4 is the high G, so the array is in string order, not pitch order.
  { name: 'Ukulele standard', instrument: 'ukulele', strings: [67, 60, 64, 69] },
  {
    name: '12-string standard',
    instrument: 'twelveString',
    strings: [40, 45, 50, 55, 59, 64],
    courses: [12, 12, 12, 12, 0, 0],
  },
  // The 5-string banjos are re-entrant like the ukulele: string 5, the drone, is the high one.
  { name: 'Banjo Open G', instrument: 'banjo', strings: [67, 50, 55, 59, 62], drone: BANJO_DRONE },
  {
    name: 'Banjo Double C',
    instrument: 'banjo',
    strings: [67, 48, 55, 60, 62],
    drone: BANJO_DRONE,
  },
  { name: 'Banjo Open D', instrument: 'banjo', strings: [69, 50, 54, 57, 62], drone: BANJO_DRONE },
  { name: 'Banjo G modal', instrument: 'banjo', strings: [67, 50, 55, 60, 62], drone: BANJO_DRONE },
  { name: 'Tenor banjo CGDA', instrument: 'banjo', strings: [48, 55, 62, 69] },
  { name: 'Irish tenor banjo GDAE', instrument: 'banjo', strings: [43, 50, 57, 64] },
  {
    name: 'Mandolin GDAE',
    instrument: 'mandolin',
    strings: [55, 62, 69, 76],
    courses: [0, 0, 0, 0],
  },
  // Appended after the older rows: with no program hint, an equal tuning keeps the older name
  // (CGDA is "Tenor banjo CGDA", EADG "Bass standard"); see `findTuningName`'s `program`.
  { name: 'Violin GDAE', instrument: 'violin', strings: [55, 62, 69, 76] },
  { name: 'Viola CGDA', instrument: 'viola', strings: [48, 55, 62, 69] },
  { name: 'Cello CGDA', instrument: 'cello', strings: [36, 43, 50, 57] },
  { name: 'Double bass EADG', instrument: 'doubleBass', strings: [28, 33, 38, 43] },
  // C3 reference; the tuning is relative to the singer, so players retune anyway.
  { name: 'Shamisen honchoshi', instrument: 'shamisen', strings: [48, 53, 60] },
  { name: 'Shamisen niagari', instrument: 'shamisen', strings: [48, 55, 60] },
  { name: 'Shamisen sansagari', instrument: 'shamisen', strings: [48, 53, 58] },
  {
    name: 'Mandola CGDA',
    instrument: 'mandola',
    strings: [48, 55, 62, 69],
    courses: [0, 0, 0, 0],
  },
  {
    name: 'Octave mandolin GDAE',
    instrument: 'octaveMandolin',
    strings: [43, 50, 57, 64],
    courses: [0, 0, 0, 0],
  },
  { name: 'Ukulele low G', instrument: 'ukulele', strings: [55, 60, 64, 69] },
  { name: 'Baritone ukulele DGBE', instrument: 'ukulele', strings: [50, 55, 59, 64] },
];

/** The instrument a General MIDI program points at, to pick between presets of equal strings. */
const INSTRUMENT_OF_PROGRAM: ReadonlyMap<number, TuningInstrument> = new Map([
  [40, 'violin'],
  [41, 'viola'],
  [42, 'cello'],
  [43, 'doubleBass'],
  [105, 'banjo'],
  [106, 'shamisen'],
  ...[32, 33, 34, 35, 36, 37, 38, 39].map((program): [number, TuningInstrument] => [
    program,
    'bass',
  ]),
]);

function sameCourses(
  preset: readonly (number | null)[] | undefined,
  courses: readonly (number | null)[] | undefined,
): boolean {
  const single = (list: readonly (number | null)[] | undefined): boolean =>
    list === undefined || list.every((offset) => offset === null);
  if (single(preset) || single(courses)) return single(preset) && single(courses);
  return (
    preset?.length === courses?.length &&
    preset?.every((offset, i) => offset === courses?.[i]) === true
  );
}

/**
 * The table name of an exact tuning, string count, courses and drone included, so a 12-string's
 * E standard is "12-string standard", not "E standard"; `undefined` for a custom tuning.
 */
export function findTuningName(
  tuning: readonly number[],
  extras: {
    courses?: readonly (number | null)[] | undefined;
    drone?: Drone | undefined;
    /** Breaks a tie between presets of equal strings, courses and drone (viola against tenor banjo). */
    program?: number | undefined;
  } = {},
): string | undefined {
  const matches = STANDARD_TUNINGS.filter(
    ({ strings, courses, drone }) =>
      strings.length === tuning.length &&
      strings.every((pitch, index) => pitch === tuning[index]) &&
      sameCourses(courses, extras.courses) &&
      drone?.string === extras.drone?.string &&
      drone?.fret === extras.drone?.fret,
  );
  const hint = extras.program === undefined ? undefined : INSTRUMENT_OF_PROGRAM.get(extras.program);
  return (matches.find(({ instrument }) => instrument === hint) ?? matches[0])?.name;
}

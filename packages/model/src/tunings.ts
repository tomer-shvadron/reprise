export type TuningInstrument = 'guitar' | 'bass' | 'ukulele';

export interface NamedTuning {
  name: string;
  instrument: TuningInstrument;
  /** Open-string MIDI notes in `Track.tuning` order: the lowest (string N) first. */
  strings: readonly number[];
}

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
  { name: 'Bass standard', instrument: 'bass', strings: [28, 33, 38, 43] },
  { name: '5-string bass standard', instrument: 'bass', strings: [23, 28, 33, 38, 43] },
  { name: 'Drop D bass', instrument: 'bass', strings: [26, 33, 38, 43] },
  // Re-entrant: string 4 is the high G, so the array is in string order, not pitch order.
  { name: 'Ukulele standard', instrument: 'ukulele', strings: [67, 60, 64, 69] },
];

/** The table name of an exact tuning, string count included; `undefined` for a custom tuning. */
export function findTuningName(tuning: readonly number[]): string | undefined {
  return STANDARD_TUNINGS.find(
    ({ strings }) =>
      strings.length === tuning.length && strings.every((pitch, index) => pitch === tuning[index]),
  )?.name;
}

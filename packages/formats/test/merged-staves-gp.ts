import { strToU8, zipSync } from 'fflate';

import {
  bar,
  beat,
  gpif,
  guitarTrack,
  masterBar,
  note,
  property,
  rhythm,
  secondStaff,
  voice,
} from '../src/gpif/test/gpif-builder';

/** Staff 1 in guitar tuning (fret 5 of the D string), staff 2 in its own tuning and capo. */
export interface TwoStaffOptions {
  program?: number;
  pitches?: string;
  capo?: number;
  /** Staff 2's `Midi` property; null leaves it out so the pitch comes from the tuning and capo. */
  midi?: number | null;
}

export function twoStaffGp({
  program = 0,
  pitches = '28 33 38 43',
  capo = 0,
  midi = 33,
}: TwoStaffOptions = {}): Uint8Array {
  const track = guitarTrack('0', { program }).replace(
    '</Staves>',
    `${secondStaff(pitches, capo)}</Staves>`,
  );
  const xml = gpif({
    tracks: [track],
    masterBars: [masterBar('0 1')],
    bars: [bar('0', '0 -1 -1 -1'), bar('1', '1 -1 -1 -1')],
    voices: [voice('0', '0'), voice('1', '1')],
    beats: [beat('0', '0', '0'), beat('1', '0', '1')],
    notes: [
      note('0', 2, 5),
      note(
        '1',
        0,
        5,
        '',
        midi === null ? '' : property('Midi', `<Number>${String(midi)}</Number>`),
      ),
    ],
    rhythms: [rhythm('0', 'Whole')],
  });
  return zipSync({ 'Content/score.gpif': strToU8(xml) });
}

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

/** A keyboard-style track: staff 1 in guitar tuning, staff 2 an octave-and-a-half lower. */
export function twoStaffGp(): Uint8Array {
  const track = guitarTrack('0', { program: 0 }).replace(
    '</Staves>',
    `${secondStaff('28 33 38 43')}</Staves>`,
  );
  const xml = gpif({
    tracks: [track],
    masterBars: [masterBar('0 1')],
    bars: [bar('0', '0 -1 -1 -1'), bar('1', '1 -1 -1 -1')],
    voices: [voice('0', '0'), voice('1', '1')],
    beats: [beat('0', '0', '0'), beat('1', '0', '1')],
    notes: [note('0', 2, 5), note('1', 0, 5, '', property('Midi', '<Number>33</Number>'))],
    rhythms: [rhythm('0', 'Whole')],
  });
  return zipSync({ 'Content/score.gpif': strToU8(xml) });
}

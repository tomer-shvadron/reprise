export type NoteHead = 'normal' | 'cross' | 'diamond' | 'triangle';

export interface PercussionInstrument {
  midi: number;
  name: string;
  /** Default line or space on the five-line percussion staff, numbered as `staffPosition`. */
  staffPosition: number;
  noteHead: NoteHead;
}

type Entry = readonly [midi: number, name: string, staffPosition: number, noteHead: NoteHead];

// GM2 adds 27 to 34 and 82 to 87 around the GM set (35 to 81); Guitar Pro files use both.
const ENTRIES: readonly Entry[] = [
  [27, 'High Q', 10, 'cross'],
  [28, 'Slap', 5, 'cross'],
  [29, 'Scratch Push', 9, 'diamond'],
  [30, 'Scratch Pull', 9, 'diamond'],
  [31, 'Sticks', 5, 'cross'],
  [32, 'Square Click', 10, 'cross'],
  [33, 'Metronome Click', 10, 'triangle'],
  [34, 'Metronome Bell', 10, 'diamond'],
  [35, 'Acoustic Bass Drum', 1, 'normal'],
  [36, 'Bass Drum 1', 1, 'normal'],
  [37, 'Side Stick', 5, 'cross'],
  [38, 'Acoustic Snare', 5, 'normal'],
  [39, 'Hand Clap', 5, 'triangle'],
  [40, 'Electric Snare', 5, 'normal'],
  [41, 'Low Floor Tom', 0, 'normal'],
  [42, 'Closed Hi-Hat', 9, 'cross'],
  [43, 'High Floor Tom', 2, 'normal'],
  [44, 'Pedal Hi-Hat', -1, 'cross'],
  [45, 'Low Tom', 3, 'normal'],
  [46, 'Open Hi-Hat', 9, 'cross'],
  [47, 'Low-Mid Tom', 4, 'normal'],
  [48, 'Hi-Mid Tom', 6, 'normal'],
  [49, 'Crash Cymbal 1', 10, 'cross'],
  [50, 'High Tom', 7, 'normal'],
  [51, 'Ride Cymbal 1', 8, 'cross'],
  [52, 'Chinese Cymbal', 11, 'cross'],
  [53, 'Ride Bell', 8, 'diamond'],
  [54, 'Tambourine', 9, 'triangle'],
  [55, 'Splash Cymbal', 11, 'diamond'],
  [56, 'Cowbell', 7, 'triangle'],
  [57, 'Crash Cymbal 2', 11, 'cross'],
  [58, 'Vibraslap', 3, 'triangle'],
  [59, 'Ride Cymbal 2', 7, 'cross'],
  [60, 'Hi Bongo', 6, 'triangle'],
  [61, 'Low Bongo', 4, 'triangle'],
  [62, 'Mute Hi Conga', 6, 'cross'],
  [63, 'Open Hi Conga', 6, 'normal'],
  [64, 'Low Conga', 4, 'normal'],
  [65, 'High Timbale', 7, 'diamond'],
  [66, 'Low Timbale', 5, 'diamond'],
  [67, 'High Agogo', 8, 'triangle'],
  [68, 'Low Agogo', 6, 'diamond'],
  [69, 'Cabasa', 8, 'diamond'],
  [70, 'Maracas', 9, 'normal'],
  [71, 'Short Whistle', 10, 'normal'],
  [72, 'Long Whistle', 10, 'diamond'],
  [73, 'Short Guiro', 8, 'normal'],
  [74, 'Long Guiro', 8, 'triangle'],
  [75, 'Claves', 4, 'cross'],
  [76, 'Hi Wood Block', 3, 'cross'],
  [77, 'Low Wood Block', 2, 'cross'],
  [78, 'Mute Cuica', 7, 'normal'],
  [79, 'Open Cuica', 6, 'normal'],
  [80, 'Mute Triangle', 11, 'triangle'],
  [81, 'Open Triangle', 11, 'normal'],
  [82, 'Shaker', 9, 'triangle'],
  [83, 'Jingle Bell', 10, 'triangle'],
  [84, 'Bell Tree', 11, 'diamond'],
  [85, 'Castanets', 4, 'diamond'],
  [86, 'Mute Surdo', 0, 'cross'],
  [87, 'Open Surdo', 0, 'diamond'],
];

export const PERCUSSION_INSTRUMENTS: readonly PercussionInstrument[] = ENTRIES.map(
  ([midi, name, staffPosition, noteHead]) => ({ midi, name, staffPosition, noteHead }),
);

const BY_MIDI = new Map(PERCUSSION_INSTRUMENTS.map((instrument) => [instrument.midi, instrument]));

/** The drum-staff defaults for a percussion-channel note; `undefined` outside GM and GM2. */
export function percussionInstrument(midi: number): PercussionInstrument | undefined {
  return BY_MIDI.get(midi);
}

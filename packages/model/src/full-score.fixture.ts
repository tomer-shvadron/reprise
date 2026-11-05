import type { Beat } from './beat';
import {
  STANDARD_TUNING,
  createBar,
  createBeat,
  createMasterBar,
  createNote,
  createScoreMeta,
  createTrack,
  createVoice,
} from './factories';
import { newId } from './id';
import type { Note } from './note';
import type { Score } from './score';

/** A schema- and invariant-valid score that sets every node type and optional field. */
export function buildFullScore(): Score {
  const bend = createNote({
    string: 3,
    fret: 7,
    bend: {
      kind: 'bendRelease',
      points: [
        { position: 0, value: 0 },
        { position: 30, value: 4 },
        { position: 60, value: 0 },
      ],
    },
    slide: ['legato'],
    harmonic: { kind: 'artificial', value: 12 },
    trill: { fret: 9, speed: 32 },
    leftHandFinger: 'ring',
    rightHandFinger: 'index',
    accent: 'heavy',
    vibrato: 'wide',
    accidental: 'flat',
    dynamics: 'mp',
  });
  const chord: Beat = createBeat({
    duration: 8,
    dots: 1,
    notes: [bend, createNote({ string: 2, fret: 8, palmMute: true, letRing: true })],
    text: 'let ring',
    chord: {
      name: 'Am',
      diagram: {
        baseFret: 1,
        frets: [0, 1, 2, 2, 0, null],
        barres: [{ fret: 1, firstString: 1, lastString: 2 }],
        fingering: [null, 'index', 'ring', 'middle', null, null],
      },
    },
    effects: {
      tremoloPicking: 16,
      pickStroke: 'down',
      fadeIn: true,
      arpeggio: { direction: 'up', duration: 16 },
      brush: { direction: 'down' },
      vibrato: 'slight',
      whammy: {
        kind: 'dive',
        points: [
          { position: 0, value: 0 },
          { position: 60, value: -8 },
        ],
      },
    },
    grace: [{ duration: 32, before: true, notes: [createNote({ string: 3, fret: 5 })] }],
    mix: {
      program: 29,
      volume: { value: 90, duration: 2, allTracks: true },
      pan: { value: 32 },
      tempo: { bpm: 96.5, unit: 'eighth', duration: 4, label: 'Slower' },
    },
    lyrics: ['Hel-', '', 'lo'],
  });
  const tied: Note = createNote({ string: 3, fret: 7, tie: true });
  const triplet = createBeat({ duration: 8, tuplet: { n: 3, of: 2 }, notes: [tied] });
  const rest = createBeat({ duration: 2, rest: true });
  const tiny = createBeat({ duration: 256, rest: true, chord: { name: 'E7' } });

  const guitar = createTrack('fretted', {
    bars: [
      {
        ...createBar(),
        voices: [
          createVoice([chord, triplet, rest, tiny]),
          createVoice(),
          createVoice(),
          createVoice(),
        ],
      },
      createBar({ clef: 'bass' }),
    ],
    channel: {
      volume: 90,
      pan: 64,
      chorus: 0,
      reverb: 20,
      phaser: 0,
      tremolo: 0,
      mute: false,
      solo: true,
    },
    sound: { packId: newId(), preset: 'clean' },
    lyrics: [
      { startBar: 0, text: 'Hel-lo' },
      { startBar: 1, text: 'world' },
    ],
  });
  const kick = createNote({ string: 0, fret: 36 });
  const drums = createTrack('drums', {
    bars: [
      {
        ...createBar(),
        voices: [
          createVoice([createBeat({ notes: [kick] })]),
          createVoice(),
          createVoice(),
          createVoice(),
        ],
      },
      createBar(),
    ],
  });
  // A GP5 keyboard part keeps the tuning it was written against.
  const keys = createTrack('pitched', {
    tuning: [...STANDARD_TUNING],
    fretCount: 24,
    bars: [
      {
        ...createBar(),
        voices: [
          createVoice([createBeat({ notes: [createNote({ string: 0, fret: 60 })] })]),
          createVoice(),
          createVoice(),
          createVoice(),
        ],
      },
      createBar(),
    ],
  });

  return {
    id: newId(),
    meta: createScoreMeta({ title: 'Fixture', notices: ['one', 'two'] }),
    masterBars: [
      createMasterBar({
        tempo: { bpm: 120, unit: 'dottedQuarter', label: 'Moderato' },
        repeat: { start: true, endCount: 2 },
        alternateEndings: [1],
        targets: ['segno'],
        section: { name: 'Intro', letter: 'A', color: '#ff8800' },
        tripletFeel: 'eighth',
        anacrusis: true,
      }),
      createMasterBar({
        timeSignature: { numerator: 6, denominator: 8 },
        keySignature: { fifths: -3, minor: true },
        alternateEndings: [2],
        jumps: [{ kind: 'dsAlFine' }, { kind: 'toCoda' }],
        doubleBar: true,
      }),
    ],
    tracks: [guitar, drums, keys],
  };
}

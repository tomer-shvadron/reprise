import type { Bar, Clef, Voice } from './bar';
import type { Beat } from './beat';
import { newId } from './id';
import type { MasterBar } from './master-bar';
import type { Note } from './note';
import type { Score, ScoreMeta } from './score';
import type { Track, TrackKind } from './track';

/** E2 A2 D3 G3 B3 E4, lowest string first. */
export const STANDARD_TUNING: readonly number[] = [40, 45, 50, 55, 59, 64];

export function createNote(
  options: Pick<Note, 'string' | 'fret'> & Partial<Omit<Note, 'id'>>,
): Note {
  return {
    id: newId(),
    tie: false,
    dead: false,
    ghost: false,
    accent: 'none',
    staccato: false,
    hammerPull: false,
    vibrato: 'none',
    palmMute: false,
    letRing: false,
    dynamics: 'f',
    ...options,
  };
}

export function createBeat(options: Partial<Omit<Beat, 'id'>> = {}): Beat {
  return {
    id: newId(),
    duration: 4,
    dots: 0,
    rest: false,
    notes: [],
    effects: {},
    ...options,
  };
}

export function createVoice(beats: Beat[] = []): Voice {
  return { id: newId(), beats };
}

export function createBar(options: { clef?: Clef } = {}): Bar {
  return {
    id: newId(),
    voices: [createVoice(), createVoice(), createVoice(), createVoice()],
    ...options,
  };
}

export function createMasterBar(options: Partial<Omit<MasterBar, 'id'>> = {}): MasterBar {
  return {
    id: newId(),
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: { fifths: 0, minor: false },
    repeat: { start: false, endCount: 0 },
    alternateEndings: [],
    jumps: [],
    targets: [],
    tripletFeel: 'none',
    doubleBar: false,
    anacrusis: false,
    ...options,
  };
}

export type TrackOptions = Partial<Omit<Track, 'id' | 'kind' | 'bars'>> & {
  /** Empty bars to create, one per master bar; ignored when `bars` is given. */
  barCount?: number;
  bars?: Bar[];
};

type TrackDefaults = Omit<Track, 'id' | 'kind' | 'bars'>;

const CHANNEL_DEFAULTS = {
  volume: 100,
  pan: 64,
  chorus: 0,
  reverb: 0,
  phaser: 0,
  tremolo: 0,
  mute: false,
  solo: false,
};

const KIND_DEFAULTS: Record<TrackKind, () => TrackDefaults> = {
  fretted: () => ({
    name: 'Guitar',
    shortName: 'Gtr.',
    color: '#d9480f',
    tuning: [...STANDARD_TUNING],
    capo: 0,
    fretCount: 24,
    program: 25,
    bank: 0,
    channel: { ...CHANNEL_DEFAULTS },
    display: { notation: 'tab', clef: 'treble', octaveShift: 1 },
    lyrics: [],
  }),
  drums: () => ({
    name: 'Drums',
    shortName: 'Drs.',
    color: '#1971c2',
    tuning: [],
    capo: 0,
    fretCount: 0,
    program: 0,
    bank: 0,
    channel: { ...CHANNEL_DEFAULTS },
    display: { notation: 'standard', clef: 'percussion', octaveShift: 0 },
    lyrics: [],
  }),
  pitched: () => ({
    name: 'Piano',
    shortName: 'Pno.',
    color: '#2f9e44',
    tuning: [],
    capo: 0,
    fretCount: 0,
    program: 0,
    bank: 0,
    channel: { ...CHANNEL_DEFAULTS },
    display: { notation: 'standard', clef: 'treble', octaveShift: 0 },
    lyrics: [],
  }),
};

export function createTrack(kind: TrackKind, options: TrackOptions = {}): Track {
  const { barCount = 1, bars, ...properties } = options;
  return {
    id: newId(),
    kind,
    ...KIND_DEFAULTS[kind](),
    ...properties,
    bars: bars ?? Array.from({ length: barCount }, () => createBar()),
  };
}

export function createScoreMeta(options: Partial<ScoreMeta> = {}): ScoreMeta {
  return {
    title: '',
    subtitle: '',
    artist: '',
    album: '',
    words: '',
    music: '',
    copyright: '',
    tab: '',
    instructions: '',
    notices: [],
    ...options,
  };
}

export function createEmptyScore(): Score {
  return {
    id: newId(),
    meta: createScoreMeta(),
    masterBars: [createMasterBar({ tempo: { bpm: 120 } })],
    tracks: [createTrack('fretted')],
  };
}

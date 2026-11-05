import type {
  Accidental,
  BeatEffects,
  Chord,
  Clef,
  DirectionTarget,
  Dynamics,
  JumpKind,
  KeySignature,
  LyricLine,
  Note,
  Section,
  TempoUnit,
  TimeSignature,
  TripletFeel,
  Tuplet,
} from '@reprise/model';

/**
 * The gpif document as read, before it becomes a score. gpif stores every node once and refers
 * to it by id (a master bar lists bar ids, a bar voice ids, and so on), and Guitar Pro 7 shares
 * identical nodes between references, so the reader collects every node into a map first and
 * resolves the references afterwards, building a fresh model node per reference.
 */
export interface GpifDocument {
  meta: GpifMeta;
  anacrusis: boolean;
  /** Track ids in score order, from `MasterTrack/Tracks`. */
  trackOrder: string[];
  tempos: GpifTempo[];
  tracks: Map<string, GpifTrack>;
  masterBars: GpifMasterBar[];
  bars: Map<string, GpifBar>;
  voices: Map<string, GpifVoice>;
  beats: Map<string, GpifBeat>;
  notes: Map<string, GpifNote>;
  rhythms: Map<string, GpifRhythm>;
}

export interface GpifMeta {
  title: string;
  subtitle: string;
  artist: string;
  album: string;
  words: string;
  music: string;
  wordsAndMusic: string;
  copyright: string;
  tab: string;
  instructions: string;
  notices: string[];
}

export interface GpifTempo {
  path: string;
  bar: number;
  /** 0 to 1 across the bar. */
  position: number;
  /** The ramp from the previous tempo automation into this one is linear. */
  linear: boolean;
  bpm: number;
  unit?: TempoUnit;
  label?: string;
}

export interface GpifTrackAutomation {
  path: string;
  type: string;
  bar: number;
  position: number;
  value: string;
}

export interface GpifSound {
  program: number;
  bank: number;
}

export interface GpifStaff {
  /** Open-string MIDI notes, lowest first, as gpif lists them. */
  tuning?: number[];
  capo: number;
  fretCount?: number;
  chords: Map<string, Chord>;
}

export interface GpifTrack {
  id: string;
  path: string;
  name: string;
  shortName: string;
  color?: string;
  drums: boolean;
  /** Output MIDI note of each drum articulation, by `InstrumentArticulation` index. */
  articulations: { name: string; output: number }[];
  staves: GpifStaff[];
  program: number;
  bank: number;
  /** Sounds by the `path;name;role` key their automations use. */
  sounds: Map<string, GpifSound>;
  volume?: number;
  pan?: number;
  mute: boolean;
  solo: boolean;
  octaveShift?: number;
  lyrics: LyricLine[];
  automations: GpifTrackAutomation[];
}

export interface GpifMasterBar {
  path: string;
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  repeatStart: boolean;
  /** Total plays when the bar closes a repeat, 0 otherwise. */
  repeatEndCount: number;
  alternateEndings: number[];
  jumps: JumpKind[];
  targets: DirectionTarget[];
  section?: Section;
  tripletFeel: TripletFeel;
  doubleBar: boolean;
  barIds: string[];
}

export type SimileMark = 'simple' | 'firstOfDouble' | 'secondOfDouble';

export interface GpifBar {
  path: string;
  clef?: Clef;
  voiceIds: string[];
  simile?: SimileMark;
}

export interface GpifVoice {
  path: string;
  beatIds: string[];
}

export interface GpifBeat {
  path: string;
  rhythmId?: string;
  noteIds: string[];
  grace?: 'before' | 'onBeat';
  dynamics?: Dynamics;
  text?: string;
  chordId?: string;
  effects: BeatEffects;
  lyrics?: string[];
}

/** Note fields that do not depend on the track; string, fret and the trill are resolved per track. */
export type NoteFields = Omit<Note, 'id' | 'string' | 'fret' | 'dynamics' | 'accidental' | 'trill'>;

export interface GpifNote {
  path: string;
  /** gpif's string index: 0 is the lowest string, the reverse of the model's numbering. */
  string?: number;
  fret?: number;
  midi?: number;
  /** Index into the track's drum articulations. */
  articulation?: number;
  /** GP6 pitched notes: `Octave` and `Tone` instead of a MIDI number. */
  octave?: number;
  tone?: number;
  accidental?: Accidental;
  /** The trill's alternate note as a MIDI value; its fret depends on the track's tuning. */
  trill?: number;
  hopoOrigin: boolean;
  hopoDestination: boolean;
  tapped: boolean;
  fields: NoteFields;
}

export interface GpifRhythm {
  path: string;
  /** Note value as a whole-note fraction denominator; 0.5 is a double whole, 0.25 a long. */
  value: number;
  dots: number;
  tuplet?: Tuplet;
}

/**
 * The common ground both models are reduced to before they are compared: plain data whose
 * leaves are primitives or arrays of primitives, so one generic diff walks either side. Strings
 * count from the highest (as `Note.string` does), controller levels are alphaTab's 0 to 16, and
 * every enum is spelled the way the score model spells it.
 */

export interface NoteProjection {
  /** From the highest string; 0 on drum and pitched tracks. */
  string: number;
  /** The fret on fretted tracks, the MIDI note on drum and pitched ones. */
  value: number;
  tie: boolean;
  dead: boolean;
  ghost: boolean;
  /** On the destination note, as the score model keeps it. */
  hammerPull: boolean;
  slides: string[];
  bendPoints: number | null;
  /** Quarter tones at the first point, the last point and the highest point. */
  bendFrom: number | null;
  bendTo: number | null;
  bendMax: number | null;
  harmonic: string | null;
  harmonicValue: number | null;
  palmMute: boolean;
  letRing: boolean;
  vibrato: string;
  trill: number[] | null;
  staccato: boolean;
  accent: string;
  dynamics: string;
  leftFinger: string | null;
  rightFinger: string | null;
}

export interface GraceProjection {
  duration: number;
  before: boolean;
  notes: NoteProjection[];
}

export interface ChordProjection {
  name: string;
  /** The grid's first fret; `null`, like `frets`, when the chord has no grid. */
  baseFret: number | null;
  /** From string 1; `null` for a muted string, and the whole grid `null` when there is none. */
  frets: (number | null)[] | null;
  /** The barres' frets, ascending; `null` with no grid. */
  barres: number[] | null;
}

export interface MixProjection {
  program: number | null;
  /** 0 to 16, as alphaTab keeps controller levels. */
  volume: number | null;
  pan: number | null;
}

export interface BeatProjection {
  duration: number;
  dots: number;
  tuplet: string | null;
  /** True for a rest; an empty beat (no notes, not a rest) is false. */
  rest: boolean;
  graces: GraceProjection[];
  text: string | null;
  chord: ChordProjection | null;
  tremoloPicking: number | null;
  vibrato: string;
  whammyPoints: number | null;
  /** Quarter tones at the first point, the last point, the highest and the lowest point. */
  whammyFrom: number | null;
  whammyTo: number | null;
  whammyMax: number | null;
  whammyMin: number | null;
  brush: string | null;
  arpeggio: string | null;
  pickStroke: string | null;
  fade: string | null;
  tapping: boolean;
  slapping: boolean;
  popping: boolean;
  mix: MixProjection | null;
  lyrics: string[] | null;
  notes: NoteProjection[];
}

export interface VoiceProjection {
  beats: BeatProjection[];
}

export interface BarProjection {
  clef: string;
  voices: VoiceProjection[];
}

export interface TrackProjection {
  name: string;
  strings: number;
  /** MIDI, lowest string first. */
  tuning: number[];
  capo: number;
  percussion: boolean;
  program: number;
  bank: number;
  /** 0 to 16, as alphaTab keeps controller levels. */
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** `#rrggbb`, lower case. */
  color: string;
  /** Written minus sounding, in octaves. */
  octaveShift: number;
  bars: BarProjection[];
}

export interface MasterBarProjection {
  timeSignature: string;
  key: string;
  repeatStart: boolean;
  repeatEnd: number;
  alternateEndings: number[];
  /** Every tempo set in the bar, in order: the score's opening tempo leads bar 0. */
  tempos: number[];
  section: string | null;
  sectionLetter: string | null;
  doubleBar: boolean;
  tripletFeel: string;
  anacrusis: boolean;
  /** Jumps and targets by the model's names, sorted. */
  directions: string[];
}

export interface MetaProjection {
  title: string;
  subtitle: string;
  artist: string;
  album: string;
  words: string;
  music: string;
  copyright: string;
  tab: string;
  instructions: string;
  /** The notice lines joined as GP3 to GP5 store them. */
  notices: string;
}

export interface ScoreProjection {
  meta: MetaProjection;
  tracks: TrackProjection[];
  masterBars: MasterBarProjection[];
}

export const isBareEmpty = (beat: BeatProjection): boolean =>
  !beat.rest &&
  beat.notes.length === 0 &&
  beat.graces.length === 0 &&
  beat.text === null &&
  beat.chord === null &&
  beat.mix === null &&
  beat.lyrics === null;

/**
 * A voice of nothing but empty beats becomes no beats, since alphaTab fills every voice a file
 * leaves empty with one; trailing empty voices past the first are then dropped, so GP3 and
 * GP4's one voice compares against the model's four.
 */
export function normaliseVoices(voices: VoiceProjection[]): VoiceProjection[] {
  const normalised = voices.map((voice) =>
    voice.beats.every(isBareEmpty) ? { beats: [] } : voice,
  );
  let end = normalised.length;
  while (end > 1 && normalised[end - 1]?.beats.length === 0) end -= 1;
  return normalised.slice(0, end);
}

/**
 * A program change on the first beat of the first bar that names the track's own program says
 * nothing the track does not: alphaTab adds one there when the file has none (`Beat.finish`).
 */
export function normaliseMix(
  mix: MixProjection | null,
  program: number,
  first: boolean,
): MixProjection | null {
  if (mix === null || !first || mix.program !== program) return mix;
  const rest = { ...mix, program: null };
  return rest.volume === null && rest.pan === null ? null : rest;
}

export const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'] as const;
export const VIBRATO = ['none', 'slight', 'wide'] as const;
export const ACCENTS = ['none', 'accent', 'heavy'] as const;
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
export const TRIPLET_FEELS = [
  'none',
  'sixteenth',
  'eighth',
  'dottedSixteenth',
  'dottedEighth',
  'scottishSixteenth',
  'scottishEighth',
] as const;
export const CLEFS = ['percussion', 'alto', 'tenor', 'bass', 'treble'] as const;

/** Controller levels are 0 to 127 in the model and 0 to 16 in alphaTab and GP3 to GP5. */
export const controllerLevel = (value: number): number => Math.floor((value * 16) / 127);

/** Sharps and flats as fifths, with the mode: `-3 minor`. */
export const keyName = (fifths: number, minor: boolean): string =>
  `${String(fifths)} ${minor ? 'minor' : 'major'}`;

export const tupletName = (n: number, of: number): string | null =>
  n <= 1 && of <= 1 ? null : `${String(n)}:${String(of)}`;

export const strokeName = (direction: string, duration: number | undefined): string =>
  duration === undefined ? direction : `${direction} ${String(duration)}`;

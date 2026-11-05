/**
 * The common ground both models are reduced to before they are compared: plain data whose
 * leaves are primitives or arrays of primitives, so one generic diff walks either side. Strings
 * count from the highest (as `Note.string` does) and every enum is spelled the way the score
 * model spells it.
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
  harmonic: string | null;
  palmMute: boolean;
  letRing: boolean;
  vibrato: string;
  trill: number[] | null;
  staccato: boolean;
  accent: string;
  dynamics: string;
}

export interface GraceProjection {
  duration: number;
  before: boolean;
  notes: NoteProjection[];
}

export interface ChordProjection {
  name: string;
  /** From string 1; `null` for a muted string, and the whole grid `null` when there is none. */
  frets: (number | null)[] | null;
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
  brush: string | null;
  lyrics: string[] | null;
  notes: NoteProjection[];
}

export interface VoiceProjection {
  beats: BeatProjection[];
}

export interface BarProjection {
  voices: VoiceProjection[];
}

export interface TrackProjection {
  name: string;
  strings: number;
  /** MIDI, lowest string first. */
  tuning: number[];
  capo: number;
  percussion: boolean;
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
}

export interface ScoreProjection {
  tracks: TrackProjection[];
  masterBars: MasterBarProjection[];
}

const isBareEmpty = (beat: BeatProjection): boolean =>
  !beat.rest &&
  beat.notes.length === 0 &&
  beat.graces.length === 0 &&
  beat.text === null &&
  beat.chord === null &&
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

export const DYNAMICS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'] as const;
export const VIBRATO = ['none', 'slight', 'wide'] as const;
export const ACCENTS = ['none', 'accent', 'heavy'] as const;

/** Sharps and flats as fifths, with the mode: `-3 minor`. */
export const keyName = (fifths: number, minor: boolean): string =>
  `${String(fifths)} ${minor ? 'minor' : 'major'}`;

export const tupletName = (n: number, of: number): string | null =>
  n <= 1 && of <= 1 ? null : `${String(n)}:${String(of)}`;

export const strokeName = (direction: string, duration: number | undefined): string =>
  duration === undefined ? direction : `${direction} ${String(duration)}`;

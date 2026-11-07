import {
  beatTicks,
  keyAlter,
  percussionInstrument,
  soundingPitch,
  spell,
  spellNote,
  staffPosition,
  type Alter,
  type Bar,
  type Clef,
  type KeySignature,
  type Note,
  type NoteHead,
  type PitchedClef,
  type Spelling,
  type Track,
} from '@reprise/model';

/** An accidental printed before a note: the alteration it shows, and whether as a reminder. */
export interface ShownAccidental {
  alter: Alter;
  /** A courtesy accidental, in parentheses: the bar line already cancelled it. */
  courtesy: boolean;
}

/** Where a note sits on a five-line staff and the head it is drawn with. */
export interface PlacedNote {
  position: number;
  head: NoteHead;
}

type SpellTrack = Pick<Track, 'kind' | 'tuning' | 'capo'>;

const spellings = new WeakMap<
  Note,
  { track: SpellTrack; fifths: number; minor: boolean; spelling: Spelling }
>();

/** Whether a note is written as a diamond at the pitch its natural harmonic sounds. */
function naturalDiamond(note: Note): boolean {
  return note.harmonic?.kind === 'natural' && !note.dead;
}

/**
 * Whether a note also shows a diamond at the pitch its harmonic sounds: every harmonic but a
 * natural one, on a fretted track, where the sounding pitch is the string's overtone.
 */
export function soundsApart(track: Pick<Track, 'kind'>, note: Note): boolean {
  return (
    track.kind === 'fretted' && !note.dead && note.harmonic !== undefined && !naturalDiamond(note)
  );
}

/**
 * The sounding pitch spelled from the key alone: overtones are pure, so the nearest semitone, and
 * the note's stored accidental spells its fretted pitch, which a diamond does not show.
 */
function soundingSpelling(track: SpellTrack, note: Note, key: KeySignature): Spelling {
  return spell(Math.round(soundingPitch(track, note)), key);
}

/**
 * The spelling a note is written with, remembered per note: a bar's notes are spelled for itself
 * and for the bar after. A natural harmonic is written at the pitch it sounds.
 */
function spelled(track: SpellTrack, note: Note, key: KeySignature): Spelling {
  const cached = spellings.get(note);
  if (cached?.track === track && cached.fifths === key.fifths && cached.minor === key.minor) {
    return cached.spelling;
  }
  const spelling = naturalDiamond(note)
    ? soundingSpelling(track, note, key)
    : spellNote(track, note, key);
  spellings.set(note, { track, fifths: key.fifths, minor: key.minor, spelling });
  return spelling;
}

/** The key an extra sounding diamond's accidental is stored under. */
export function soundingKey(id: string): string {
  return `${id}:sounding`;
}

/** Where a drum note without a GM2 mapping goes: the middle line, with a normal head. */
const UNMAPPED_POSITION = 4;

export function pitchedClef(clef: Clef): PitchedClef {
  return clef === 'percussion' ? 'treble' : clef;
}

export function placeNote(
  track: Pick<Track, 'kind' | 'tuning' | 'capo' | 'display'>,
  note: Note,
  key: KeySignature,
  clef: Clef,
  percussion: boolean,
): PlacedNote {
  if (percussion) {
    const instrument = percussionInstrument(note.fret);
    return {
      position: instrument?.staffPosition ?? UNMAPPED_POSITION,
      head: note.dead ? 'cross' : (instrument?.noteHead ?? 'normal'),
    };
  }
  const spelling = spelled(track, note, key);
  return {
    position: staffPosition(spelling, pitchedClef(clef), track.display.octaveShift),
    head: note.dead ? 'cross' : naturalDiamond(note) ? 'diamond' : 'normal',
  };
}

/** The extra diamond of a harmonic that sounds apart from its fretted note, or undefined. */
export function harmonicHead(
  track: Pick<Track, 'kind' | 'tuning' | 'capo' | 'display'>,
  note: Note,
  key: KeySignature,
  clef: Clef,
): PlacedNote | undefined {
  if (!soundsApart(track, note)) return undefined;
  const spelling = soundingSpelling(track, note, key);
  return {
    position: staffPosition(spelling, pitchedClef(clef), track.display.octaveShift),
    head: 'diamond',
  };
}

interface TimedNote {
  tick: number;
  voice: number;
  order: number;
  note: Note;
  /** The extra diamond at the harmonic's sounding pitch, right after its note. */
  sounding: boolean;
}

/**
 * The bar's notes in reading order: by onset, voice, then grace notes before their beat, each
 * followed by its sounding diamond when it has one.
 */
function timedNotes(track: Pick<Track, 'kind'>, bar: Bar): TimedNote[] {
  const out: TimedNote[] = [];
  const push = (tick: number, voice: number, order: number, note: Note): void => {
    out.push({ tick, voice, order, note, sounding: false });
    if (soundsApart(track, note)) out.push({ tick, voice, order, note, sounding: true });
  };
  for (const [voice, { beats }] of bar.voices.entries()) {
    let tick = 0;
    for (const beat of beats) {
      let order = 0;
      for (const grace of beat.grace ?? []) {
        for (const note of grace.notes) push(tick, voice, order, note);
        order += 1;
      }
      for (const note of beat.notes) push(tick, voice, order, note);
      tick += beatTicks(beat);
    }
  }
  // A stable sort keeps each diamond right after its note.
  return out.sort((a, b) => a.tick - b.tick || a.voice - b.voice || a.order - b.order);
}

/** The alteration of the last accidental printed on each letter and octave. */
type Memory = Map<string, Alter>;

/**
 * Walks a bar in reading order with measure memory: an accidental holds for its letter and
 * octave until the bar line, so it is not repeated, and a return to the key's alteration needs
 * a natural (or the key's sign). A tied note shows nothing, but the alteration it carries in
 * holds until the next untied note of its letter and octave, which prints its own when it
 * differs. With `previous` (what the bar before printed), the first note of a letter and octave
 * that bar altered gets a courtesy accidental when it no longer needs one.
 */
function walk(
  track: Pick<Track, 'kind' | 'tuning' | 'capo'>,
  bar: Bar,
  key: KeySignature,
  previous: Memory | undefined,
  shown: Map<string, ShownAccidental> | undefined,
): Memory {
  const printed: Memory = new Map();
  const carried: Memory = new Map();
  const seen = new Set<string>();
  for (const { note, sounding } of timedNotes(track, bar)) {
    const { letter, octave, alter } = sounding
      ? soundingSpelling(track, note, key)
      : spelled(track, note, key);
    const slot = `${letter}${String(octave)}`;
    const id = sounding ? soundingKey(note.id) : note.id;
    if (note.tie && !sounding) {
      if (!printed.has(slot)) carried.set(slot, alter);
      continue;
    }
    const current = printed.get(slot) ?? keyAlter(key, letter);
    const before = previous?.get(slot);
    const tied = carried.get(slot);
    if (alter !== current || (tied !== undefined && tied !== alter)) {
      shown?.set(id, { alter, courtesy: false });
      printed.set(slot, alter);
    } else if (before !== undefined && before !== alter && !seen.has(slot)) {
      shown?.set(id, { alter, courtesy: true });
    }
    carried.delete(slot);
    seen.add(slot);
  }
  return printed;
}

/**
 * The accidental each note of `bar` prints, by note id, and each sounding diamond's by
 * `soundingKey`; notes that print none are absent.
 */
export function barAccidentals(
  track: Pick<Track, 'kind' | 'tuning' | 'capo'>,
  bar: Bar,
  key: KeySignature,
  previous: { bar: Bar; key: KeySignature } | undefined,
): Map<string, ShownAccidental> {
  const shown = new Map<string, ShownAccidental>();
  const memory = previous && walk(track, previous.bar, previous.key, undefined, undefined);
  walk(track, bar, key, memory, shown);
  return shown;
}

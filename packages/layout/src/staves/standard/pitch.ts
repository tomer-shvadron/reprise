import {
  beatTicks,
  keyAlter,
  percussionInstrument,
  spellNote,
  staffPosition,
  type Alter,
  type Bar,
  type Clef,
  type Id,
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

/** `spellNote`, remembered per note: a bar's notes are spelled for itself and for the bar after. */
function spelled(track: SpellTrack, note: Note, key: KeySignature): Spelling {
  const cached = spellings.get(note);
  if (cached?.track === track && cached.fifths === key.fifths && cached.minor === key.minor) {
    return cached.spelling;
  }
  const spelling = spellNote(track, note, key);
  spellings.set(note, { track, fifths: key.fifths, minor: key.minor, spelling });
  return spelling;
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
    head: note.dead ? 'cross' : 'normal',
  };
}

interface TimedNote {
  tick: number;
  voice: number;
  order: number;
  note: Note;
}

/** The bar's notes in reading order: by onset, voice, then grace notes before their beat. */
function timedNotes(bar: Bar): TimedNote[] {
  const out: TimedNote[] = [];
  for (const [voice, { beats }] of bar.voices.entries()) {
    let tick = 0;
    for (const beat of beats) {
      let order = 0;
      for (const grace of beat.grace ?? []) {
        for (const note of grace.notes) out.push({ tick, voice, order, note });
        order += 1;
      }
      for (const note of beat.notes) out.push({ tick, voice, order, note });
      tick += beatTicks(beat);
    }
  }
  return out.sort((a, b) => a.tick - b.tick || a.voice - b.voice || a.order - b.order);
}

/** The alteration of the last accidental printed on each letter and octave. */
type Memory = Map<string, Alter>;

/**
 * Walks a bar in reading order with measure memory: an accidental holds for its letter and
 * octave until the bar line, so it is not repeated, and a return to the key's alteration needs
 * a natural (or the key's sign). A tied note shows nothing and changes nothing. With `previous`
 * (what the bar before printed), the first note of a letter and octave that bar altered gets a
 * courtesy accidental when it no longer needs one.
 */
function walk(
  track: Pick<Track, 'kind' | 'tuning' | 'capo'>,
  bar: Bar,
  key: KeySignature,
  previous: Memory | undefined,
  shown: Map<Id, ShownAccidental> | undefined,
): Memory {
  const printed: Memory = new Map();
  const seen = new Set<string>();
  for (const { note } of timedNotes(bar)) {
    if (note.tie) continue;
    const { letter, octave, alter } = spelled(track, note, key);
    const slot = `${letter}${String(octave)}`;
    const current = printed.get(slot) ?? keyAlter(key, letter);
    const before = previous?.get(slot);
    if (alter !== current) {
      shown?.set(note.id, { alter, courtesy: false });
      printed.set(slot, alter);
    } else if (before !== undefined && before !== alter && !seen.has(slot)) {
      shown?.set(note.id, { alter, courtesy: true });
    }
    seen.add(slot);
  }
  return printed;
}

/** The accidental each note of `bar` prints, by note id; notes that print none are absent. */
export function barAccidentals(
  track: Pick<Track, 'kind' | 'tuning' | 'capo'>,
  bar: Bar,
  key: KeySignature,
  previous: { bar: Bar; key: KeySignature } | undefined,
): Map<Id, ShownAccidental> {
  const shown = new Map<Id, ShownAccidental>();
  const memory = previous && walk(track, previous.bar, previous.key, undefined, undefined);
  walk(track, bar, key, memory, shown);
  return shown;
}

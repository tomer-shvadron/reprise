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
  /** The written alteration; 0 on a percussion staff. */
  alter: Alter;
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
      alter: 0,
    };
  }
  const spelling = spelled(track, note, key);
  return {
    position: staffPosition(spelling, pitchedClef(clef), track.display.octaveShift),
    head: note.dead ? 'cross' : naturalDiamond(note) ? 'diamond' : 'normal',
    alter: spelling.alter,
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
    alter: spelling.alter,
  };
}

interface TimedNote {
  tick: number;
  voice: number;
  order: number;
  /** The chord it sounds in: the onset's tick for every voice's beat notes, negative for graces. */
  chord: number;
  note: Note;
  /** The extra diamond at the harmonic's sounding pitch, after the beat's main notes. */
  sounding: boolean;
  spelling: Spelling;
  /** The letter and octave, as a number. */
  slot: number;
}

/**
 * The bar's notes in reading order: by onset, voice, then grace notes before their beat; within
 * one chord in head order (main notes before sounding diamonds, the flatter alteration, the
 * higher string number), so the result does not depend on the order notes were entered in.
 */
function timedNotes(track: SpellTrack, bar: Bar, key: KeySignature): TimedNote[] {
  const out: TimedNote[] = [];
  const push = (tick: number, voice: number, order: number, chord: number, note: Note): void => {
    const spelling = spelled(track, note, key);
    out.push({
      tick,
      voice,
      order,
      chord,
      note,
      sounding: false,
      spelling,
      slot: slotOf(spelling),
    });
    if (!soundsApart(track, note)) return;
    const sounding = soundingSpelling(track, note, key);
    out.push({
      tick,
      voice,
      order,
      chord,
      note,
      sounding: true,
      spelling: sounding,
      slot: slotOf(sounding),
    });
  };
  let graces = 0;
  for (const [voice, { beats }] of bar.voices.entries()) {
    let tick = 0;
    for (const beat of beats) {
      let order = 0;
      for (const grace of beat.grace ?? []) {
        graces += 1;
        for (const note of grace.notes) push(tick, voice, order, -graces, note);
        order += 1;
      }
      for (const note of beat.notes) push(tick, voice, order, tick, note);
      tick += beatTicks(beat);
    }
  }
  return out.sort(
    (a, b) =>
      a.tick - b.tick ||
      a.voice - b.voice ||
      a.order - b.order ||
      Number(a.sounding) - Number(b.sounding) ||
      a.spelling.alter - b.spelling.alter ||
      b.note.string - a.note.string,
  );
}

/** A letter and octave as one number. */
function slotOf(spelling: Spelling): number {
  return staffPosition(spelling, 'treble');
}

/** A slot left ambiguous at the bar line by a chord sounding it at two alterations. */
const UNSETTLED = 'unsettled';

/** The alteration of the last accidental printed on each letter and octave. */
type Memory = Map<number, Alter | typeof UNSETTLED>;

/**
 * Walks a bar in reading order with measure memory: an accidental holds for its letter and
 * octave until the bar line, so it is not repeated, and a return to the key's alteration needs
 * a natural (or the key's sign). A tied note shows nothing, but the alteration it carries in
 * holds until the next untied note of its letter and octave, which prints its own when it
 * differs. A letter and octave sounding at two alterations in one chord prints one sign per
 * alteration, and the next note on it prints its own, since memory cannot tell which held; at
 * the bar line, that next note is the next bar's first, which gets a courtesy sign at least.
 * With `previous` (what the bar before printed), the first note of a letter and octave that bar
 * altered gets a courtesy accidental when it no longer needs one.
 */
function walk(
  track: SpellTrack,
  bar: Bar,
  key: KeySignature,
  previous: Memory | undefined,
  shown: Map<string, ShownAccidental> | undefined,
): Memory {
  const printed: Memory = new Map();
  const carried = new Map<number, Alter>();
  const seen = new Set<number>();
  // Slots left ambiguous by a split chord, with the chord that split them.
  const unsettled = new Map<number, number>();
  const timed = timedNotes(track, bar, key);
  let run = 0;
  for (const [i, { tick, note, sounding, chord, spelling, slot }] of timed.entries()) {
    if (timed[run]?.tick !== tick) run = i;
    const { letter, alter } = spelling;
    if (note.tie && !sounding) {
      if (!printed.has(slot)) carried.set(slot, alter);
      continue;
    }
    // Whether the chord sounds this slot at another alteration, and whether an earlier head of
    // it already signs this one.
    let split = false;
    let signed = false;
    for (let j = run; j < timed.length; j++) {
      const other = timed[j];
      if (other?.tick !== tick) break;
      if (j === i || other.chord !== chord || other.slot !== slot) continue;
      if (other.note.tie && !other.sounding) continue;
      if (other.spelling.alter !== alter) split = true;
      else if (j < i) signed = true;
    }
    const id = sounding ? soundingKey(note.id) : note.id;
    const held = printed.get(slot);
    const current = held === undefined || held === UNSETTLED ? keyAlter(key, letter) : held;
    const before = previous?.get(slot);
    const tied = carried.get(slot);
    const settledBy = unsettled.get(slot);
    const owed = settledBy !== undefined && settledBy !== chord;
    if (alter !== current || (tied !== undefined && tied !== alter) || (split && !signed) || owed) {
      shown?.set(id, { alter, courtesy: false });
      printed.set(slot, alter);
    } else if (
      before !== undefined &&
      (before === UNSETTLED || before !== alter) &&
      !seen.has(slot)
    ) {
      shown?.set(id, { alter, courtesy: true });
    }
    if (split) unsettled.set(slot, chord);
    else if (owed) unsettled.delete(slot);
    carried.delete(slot);
    seen.add(slot);
  }
  for (const slot of unsettled.keys()) printed.set(slot, UNSETTLED);
  return printed;
}

const memories = new WeakMap<
  Bar,
  { track: SpellTrack; fifths: number; minor: boolean; memory: Memory }
>();

/** What a bar's walk leaves in measure memory, remembered per bar for the bar after. */
function barMemory(track: SpellTrack, bar: Bar, key: KeySignature): Memory {
  const cached = memories.get(bar);
  if (cached?.track === track && cached.fifths === key.fifths && cached.minor === key.minor) {
    return cached.memory;
  }
  const memory = walk(track, bar, key, undefined, undefined);
  memories.set(bar, { track, fifths: key.fifths, minor: key.minor, memory });
  return memory;
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
  const memory = previous && barMemory(track, previous.bar, previous.key);
  const printed = walk(track, bar, key, memory, shown);
  memories.set(bar, { track, fifths: key.fifths, minor: key.minor, memory: printed });
  return shown;
}

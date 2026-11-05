import { createNote } from '@reprise/model';
import type { Beat, GraceBeat, Harmonic, Note, SlideKind, Trill } from '@reprise/model';

import { hasFlag } from '../binary/binary-reader';
import { invalid } from './context';
import type { Context } from './context';
import { bendKind, dynamicsOf, fingerOf, harmonicPosition, readBendPoints } from './effects';
import type { TrackInfo } from './tracks';

export interface NoteLocation {
  offset: number;
  track: number;
  bar: number;
  voice: number;
  beat: number;
}

/** GP's fret is a signed byte; drum and pitched tracks reuse it for a MIDI-range value. */
function fretValue(context: Context, location: NoteLocation, raw: number): number {
  if (raw >= 0) return raw;
  invalid(context, location, 'fret', raw, 0);
  return 0;
}

/**
 * Reads one note. `string` is Guitar Pro's string number (1 = highest) on every kind of track;
 * the finishing pass turns drum and pitched notes into MIDI values once ties are resolved.
 */
export function readNote(
  context: Context,
  info: TrackInfo,
  beat: Beat,
  string: number,
  location: NoteLocation,
): Note {
  const { reader, version, log } = context;
  const offset = reader.offset;
  const here = { ...location, offset };
  const flags = reader.byte();
  const note = createNote({ string, fret: 0 });
  if (hasFlag(flags, 0x02)) note.accent = 'heavy';
  else if (hasFlag(flags, 0x40)) note.accent = 'accent';
  note.ghost = hasFlag(flags, 0x04);

  if (hasFlag(flags, 0x20)) {
    const type = reader.byte();
    if (type === 2) note.tie = true;
    else if (type === 3) note.dead = true;
    else if (type !== 1) invalid(context, here, 'note type', type, 'a normal note');
  }
  if (hasFlag(flags, 0x01) && version < 500) {
    log.info('note-duration-dropped', 'a time-independent note duration', here);
    reader.skip(2);
  }
  if (hasFlag(flags, 0x10)) {
    const value = reader.signedByte();
    const dynamics = dynamicsOf(value);
    if (dynamics) note.dynamics = dynamics;
    else invalid(context, here, 'dynamics', value, note.dynamics);
  }
  if (hasFlag(flags, 0x20)) note.fret = fretValue(context, here, reader.signedByte());
  if (hasFlag(flags, 0x80)) {
    const left = fingerOf(reader.signedByte());
    const right = fingerOf(reader.signedByte());
    if (left) note.leftHandFinger = left;
    if (right) note.rightHandFinger = right;
  }
  let swapAccidentals = false;
  if (version >= 500) {
    if (hasFlag(flags, 0x01)) {
      log.info('note-duration-dropped', 'a note duration percentage', here);
      reader.doubleBigEndian();
    }
    swapAccidentals = hasFlag(reader.byte(), 0x02);
  }
  let hammerOrigin = false;
  if (hasFlag(flags, 0x08)) hammerOrigin = readNoteEffects(context, info, beat, note, here);
  context.noteFacts.set(note, { offset, hammerOrigin, swapAccidentals });
  return note;
}

/** Returns whether the note starts a hammer-on or pull-off. */
function readNoteEffects(
  context: Context,
  info: TrackInfo,
  beat: Beat,
  note: Note,
  location: NoteLocation,
): boolean {
  const { reader, version } = context;
  const flags = reader.byte();
  const flags2 = version >= 400 ? reader.byte() : 0;

  if (hasFlag(flags, 0x01)) {
    const bend = readBendPoints(context);
    if (bend.points.length >= 2) {
      note.bend = { kind: bendKind(bend.type), points: bend.points };
    } else if (bend.points.length > 0 || bend.type !== 0) {
      const where = { ...location, offset: bend.offset };
      invalid(context, where, 'bend point count', bend.points.length, 'no bend');
    }
  }
  if (hasFlag(flags, 0x10)) readGrace(context, beat, note, location);
  if (hasFlag(flags2, 0x04)) readTremoloPicking(context, beat, location);
  if (hasFlag(flags2, 0x08)) {
    const slide = readSlide(context, location);
    if (slide.length > 0) note.slide = slide;
  } else if (version < 400 && hasFlag(flags, 0x04)) {
    note.slide = ['shift'];
  }
  if (hasFlag(flags2, 0x10)) {
    const harmonic = readHarmonic(context, info, note, location);
    if (harmonic) note.harmonic = harmonic;
  }
  if (hasFlag(flags2, 0x20)) {
    const trill = readTrill(context, location);
    if (trill) note.trill = trill;
  }
  note.letRing = hasFlag(flags, 0x08);
  if (hasFlag(flags2, 0x40)) note.vibrato = 'slight';
  note.palmMute = hasFlag(flags2, 0x02);
  note.staccato = hasFlag(flags2, 0x01);
  return hasFlag(flags, 0x02);
}

/**
 * GP3 to GP5 store one grace note per note, on the main note's string. Its transition to the
 * main note becomes ordinary note fields: a slide on the grace note, a bend up to the main
 * note's pitch on it, or a hammer-on flag on the main note.
 */
function readGrace(context: Context, beat: Beat, note: Note, location: NoteLocation): void {
  const { reader, version } = context;
  const offset = reader.offset;
  const here = { ...location, offset };
  // GP3 and GP4 write a dead grace note as fret -1; GP5 moved that to a flag but may still do so.
  const rawFret = reader.signedByte();
  const fret = rawFret === -1 ? 0 : fretValue(context, here, rawFret);
  const dynamicsValue = reader.signedByte();
  const transition = reader.signedByte();
  const durationValue = reader.byte();
  const grace = createNote({
    string: note.string,
    fret,
    dead: rawFret === -1,
    dynamics: dynamicsOf(dynamicsValue) ?? 'f',
  });
  let before = true;
  if (version >= 500) {
    const flags = reader.byte();
    if (hasFlag(flags, 0x01)) grace.dead = true;
    before = !hasFlag(flags, 0x02);
  }
  switch (transition) {
    case 0: {
      break;
    }
    case 1: {
      grace.slide = ['legato'];
      break;
    }
    case 2: {
      // The bend reaches the main note; its fret is only known for certain on a normal note.
      const semitones = note.fret - fret;
      if (semitones > 0) {
        grace.bend = {
          kind: 'bend',
          points: [
            { position: 0, value: 0 },
            { position: 60, value: semitones * 2 },
          ],
        };
      }
      break;
    }
    case 3: {
      note.hammerPull = true;
      break;
    }
    default: {
      invalid(context, here, 'grace note transition', transition, 'none');
    }
  }
  // 1, 2 and 3 are a sixty-fourth, a thirty-second and a sixteenth.
  const duration = durationValue === 2 ? 32 : durationValue === 3 ? 16 : 64;
  if (durationValue < 1 || durationValue > 3) {
    invalid(context, here, 'grace note duration', durationValue, duration);
  }
  const entry: GraceBeat = { duration, before, notes: [grace] };
  context.noteFacts.set(grace, { offset, hammerOrigin: false, swapAccidentals: false });
  beat.grace = [...(beat.grace ?? []), entry];
}

function readTremoloPicking(context: Context, beat: Beat, location: NoteLocation): void {
  const offset = context.reader.offset;
  const value = context.reader.byte();
  // 1, 2 and 3 are eighth, sixteenth and thirty-second strokes.
  if (value === 1) beat.effects.tremoloPicking = 8;
  else if (value === 2) beat.effects.tremoloPicking = 16;
  else if (value === 3) beat.effects.tremoloPicking = 32;
  else invalid(context, { ...location, offset }, 'tremolo picking speed', value, 'none');
}

const GP4_SLIDES: Readonly<Record<number, SlideKind>> = {
  1: 'shift',
  2: 'legato',
  3: 'outDown',
  4: 'outUp',
  [-1]: 'intoFromBelow',
  [-2]: 'intoFromAbove',
};

/** GP5's slide byte is a mask, so a note can slide in and out at once. */
const GP5_SLIDES: readonly [number, SlideKind][] = [
  [0x01, 'shift'],
  [0x02, 'legato'],
  [0x04, 'outDown'],
  [0x08, 'outUp'],
  [0x10, 'intoFromBelow'],
  [0x20, 'intoFromAbove'],
];

function readSlide(context: Context, location: NoteLocation): SlideKind[] {
  const { reader, version } = context;
  const offset = reader.offset;
  const value = reader.signedByte();
  if (version >= 500) {
    return GP5_SLIDES.filter(([bit]) => hasFlag(value, bit)).map(([, kind]) => kind);
  }
  const kind = GP4_SLIDES[value];
  if (kind) return [kind];
  if (value !== 0) invalid(context, { ...location, offset }, 'slide', value, 'none');
  return [];
}

/** GP4 encodes an artificial harmonic's interval in its type: 15, 17 and 22 are +5, +7, +12. */
const GP4_ARTIFICIAL: Readonly<Record<number, number>> = { 15: 5, 17: 7, 22: 12 };

function readHarmonic(
  context: Context,
  info: TrackInfo,
  note: Note,
  location: NoteLocation,
): Harmonic | undefined {
  const { reader, version } = context;
  const offset = reader.offset;
  const type = reader.byte();
  switch (type) {
    case 1: {
      return { kind: 'natural', value: harmonicPosition(note.fret) };
    }
    case 2: {
      if (version < 500) break;
      // The harmonic's pitch class, its accidental (-1, 0, 1) and its octave above the note.
      const tone = reader.byte();
      const accidental = reader.signedByte();
      const octave = reader.byte();
      const open = info.gpTuning[note.string - 1] ?? 0;
      const played = (open + note.fret) % 12;
      let target = tone + accidental + octave * 12;
      if (target < played) target += 12;
      return { kind: 'artificial', value: harmonicPosition(target - played) };
    }
    case 3: {
      // GP5 stores the tapped fret's distance; GP4 always taps the octave.
      const delta = version >= 500 ? reader.byte() : 12;
      return { kind: 'tapped', value: harmonicPosition(delta) };
    }
    case 4: {
      return { kind: 'pinch', value: 12 };
    }
    case 5: {
      return { kind: 'semi', value: 12 };
    }
    default: {
      const interval = version < 500 ? GP4_ARTIFICIAL[type] : undefined;
      if (interval !== undefined) return { kind: 'artificial', value: harmonicPosition(interval) };
    }
  }
  invalid(context, { ...location, offset }, 'harmonic type', type, 'no harmonic');
  return undefined;
}

function readTrill(context: Context, location: NoteLocation): Trill | undefined {
  const { reader } = context;
  const offset = reader.offset;
  const fret = reader.signedByte();
  const period = reader.byte();
  // 1, 2 and 3 alternate in sixteenths, thirty-seconds and sixty-fourths.
  const speed = period === 2 ? 32 : period === 3 ? 64 : 16;
  if (period < 1 || period > 3)
    invalid(context, { ...location, offset }, 'trill speed', period, speed);
  if (fret < 0) {
    invalid(context, { ...location, offset }, 'trill fret', fret, 'no trill');
    return undefined;
  }
  return { fret, speed };
}

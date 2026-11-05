import { MIDI_MAX, createBeat } from '@reprise/model';
import type {
  Beat,
  ChannelMixChange,
  Chord,
  ChordDiagram,
  Duration,
  Finger,
  HarmonicKind,
  MixerChange,
  Stroke,
  Tuplet,
} from '@reprise/model';

import { CorruptFile, hasFlag } from '../binary/binary-reader';
import { controllerValue, invalid } from './context';
import type { Context } from './context';
import { harmonicPosition, readBendPoints, whammyKind } from './effects';
import { readNote } from './notes';
import type { NoteLocation } from './notes';
import type { TrackInfo } from './tracks';

/** More beats than this in one voice is a corrupt count; Guitar Pro allows far fewer. */
const MAX_BEATS = 512;
const MAX_GP_STRINGS = 7;

export interface VoiceLocation {
  track: number;
  bar: number;
  voice: number;
}

/**
 * Reads one voice. Beats are appended to `beats` as each is completed, so a file that ends
 * inside a voice keeps the beats before the cut.
 */
export function readVoice(
  context: Context,
  info: TrackInfo,
  beats: Beat[],
  location: VoiceLocation,
): void {
  const offset = context.reader.offset;
  const count = context.reader.int();
  if (count < 0 || count > MAX_BEATS) throw new CorruptFile(offset, `${String(count)} beats`);
  for (let i = 0; i < count; i++) {
    beats.push(readBeat(context, info, { ...location, beat: i, offset: context.reader.offset }));
  }
}

/** GP stores the duration as an exponent: -2 is a whole note, 4 a sixty-fourth. */
const DURATIONS: Readonly<Record<number, Duration>> = {
  [-2]: 1,
  [-1]: 2,
  0: 4,
  1: 8,
  2: 16,
  3: 32,
  4: 64,
};

/**
 * The tuplets Guitar Pro offers, by the number of notes: each fits in the time of the next lower
 * power of two, except the duplet, quadruplet and octuplet of compound time, which fill the time
 * of three, three and six.
 */
const TUPLETS: Readonly<Record<number, Tuplet>> = {
  2: { n: 2, of: 3 },
  3: { n: 3, of: 2 },
  4: { n: 4, of: 3 },
  5: { n: 5, of: 4 },
  6: { n: 6, of: 4 },
  7: { n: 7, of: 4 },
  8: { n: 8, of: 6 },
  9: { n: 9, of: 8 },
  10: { n: 10, of: 8 },
  11: { n: 11, of: 8 },
  12: { n: 12, of: 8 },
  13: { n: 13, of: 8 },
};

function readBeat(context: Context, info: TrackInfo, location: NoteLocation): Beat {
  const { reader, version, log } = context;
  const flags = reader.byte();
  const beat = createBeat();
  if (hasFlag(flags, 0x01)) beat.dots = 1;
  if (hasFlag(flags, 0x40)) {
    // 0x02 is a rest; without it the slot is Guitar Pro's empty beat.
    beat.rest = hasFlag(reader.byte(), 0x02);
  }
  const durationValue = reader.signedByte();
  const duration = DURATIONS[durationValue];
  if (duration) beat.duration = duration;
  else invalid(context, location, 'duration', durationValue, 'a quarter note');

  if (hasFlag(flags, 0x20)) {
    const tupletOffset = reader.offset;
    const n = reader.int();
    const tuplet = TUPLETS[n];
    if (tuplet) beat.tuplet = { ...tuplet };
    else if (n !== 1) invalid(context, { ...location, offset: tupletOffset }, 'tuplet', n, 'none');
  }
  if (hasFlag(flags, 0x02)) {
    const chord = readChord(context, info, location);
    if (chord) beat.chord = chord;
  }
  if (hasFlag(flags, 0x04)) beat.text = reader.intByteString('byte');
  let noteWide: NoteWideEffects = {};
  if (hasFlag(flags, 0x08)) noteWide = readBeatEffects(context, beat, location);
  if (hasFlag(flags, 0x10)) {
    const mix = readMixTable(context, location);
    if (Object.keys(mix).length > 0) beat.mix = mix;
  }

  const stringsOffset = reader.offset;
  const strings = reader.byte();
  // Bit 6 is string 1, the highest; bit 0 is string 7.
  for (let string = 1; string <= MAX_GP_STRINGS; string++) {
    if (!hasFlag(strings, 1 << (MAX_GP_STRINGS - string))) continue;
    // A bit for a string the track lacks carries no note block: every reader of the format
    // skips it unread, and reading one would desync from them on a damaged file.
    if (string > info.gpTuning.length) {
      log.warn(
        'note-off-string',
        `a note on string ${String(string)} of a ${String(info.gpTuning.length)}-string track was dropped`,
        { ...location, offset: stringsOffset },
      );
      continue;
    }
    const note = readNote(context, info, beat, string, location);
    // GP3's beat-level harmonics apply to each note, at the node its fret names.
    if (noteWide.harmonic) {
      note.harmonic = { kind: noteWide.harmonic, value: harmonicPosition(note.fret) };
    }
    if (noteWide.vibrato && note.vibrato === 'none') note.vibrato = 'slight';
    beat.notes.push(note);
  }
  if (beat.rest && beat.notes.length > 0) {
    log.warn('invalid-value', 'a rest carries notes; read as a played beat', location);
    beat.rest = false;
  }

  if (version >= 500) {
    const displayOffset = reader.offset;
    const display = reader.short();
    // Ottava lines: 8va, 8vb, 15ma, 15mb.
    if ((display & 0x0170) !== 0) {
      log.info('ottava-dropped', 'an ottava line', { ...location, offset: displayOffset });
    }
    // Beam breaks and directions and tuplet bracket display.
    if ((display & ~0x0170 & 0xffff) !== 0) {
      log.info('beat-display-dropped', 'beaming, stem direction or bracket display', {
        ...location,
        offset: displayOffset,
      });
    }
    if (hasFlag(display, 0x0800)) reader.skip(1);
  }
  return beat;
}

const FINGERS: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];

function readChord(context: Context, info: TrackInfo, location: NoteLocation): Chord | undefined {
  const { reader, version, log } = context;
  const offset = reader.offset;
  const here = { ...location, offset };
  const stringCount = info.gpTuning.length;
  const newFormat = reader.byte() !== 0 || version >= 500;
  let name: string;
  let firstFret: number;
  let frets: number[] = [];
  let barres: { fret: number; start: number; end: number }[] = [];
  let fingers: number[] = [];

  if (!newFormat) {
    name = reader.intByteString('int');
    firstFret = reader.int();
    if (firstFret !== 0) {
      const slots = version >= 406 ? 7 : 6;
      for (let i = 0; i < slots; i++) frets.push(reader.int());
    }
  } else if (version < 400) {
    log.info('chord-construction-dropped', "the chord wizard's root, type and options", here);
    reader.skip(25);
    name = reader.fixedString(34);
    firstFret = reader.int();
    for (let i = 0; i < 6; i++) frets.push(reader.int());
    // Up to two barres as ints: the count, then frets, start strings and end strings in pairs.
    const barreCount = Math.min(2, reader.int());
    const barreFrets = [reader.int(), reader.int()];
    const starts = [reader.int(), reader.int()];
    const ends = [reader.int(), reader.int()];
    barres = Array.from({ length: Math.max(0, barreCount) }, (_, i) => ({
      fret: barreFrets[i] ?? 0,
      start: starts[i] ?? 0,
      end: ends[i] ?? 0,
    }));
    // The omitted chord tones and a padding byte.
    reader.skip(7 + 1);
  } else {
    log.info('chord-construction-dropped', "the chord wizard's root, type and options", here);
    // Sharp, root, type, extension, bass, tonality and added note.
    reader.skip(16);
    name = reader.fixedString(21);
    // Fifth, ninth and eleventh alterations.
    reader.skip(4);
    firstFret = reader.int();
    for (let i = 0; i < 7; i++) frets.push(reader.int());
    // Up to five barres as three parallel arrays: fret, then the two strings it spans. Slots past
    // the count hold whatever the chord dialog left there.
    const barreCount = Math.min(5, reader.byte());
    const barreFrets = [...reader.bytesOf(5)];
    const starts = [...reader.bytesOf(5)];
    const ends = [...reader.bytesOf(5)];
    barres = Array.from({ length: barreCount }, (_, i) => ({
      fret: barreFrets[i] ?? 0,
      start: starts[i] ?? 0,
      end: ends[i] ?? 0,
    }));
    // The omitted chord tones and a padding byte.
    reader.skip(7 + 1);
    fingers = [...reader.bytesOf(7)].map((byte) => (byte > 127 ? byte - 256 : byte));
    // Whether to show the fingering.
    reader.skip(1);
  }

  frets = frets.slice(0, stringCount);
  const hasGrid = frets.some((fret) => fret >= 0);
  if (!hasGrid) return name === '' ? undefined : { name };
  const diagram: ChordDiagram = {
    baseFret: Math.max(1, firstFret),
    frets: Array.from({ length: stringCount }, (_, i) => {
      const fret = frets[i] ?? -1;
      return fret >= 0 ? Math.min(fret, MIDI_MAX) : null;
    }),
  };
  const inRange = (string: number): boolean => string >= 1 && string <= stringCount;
  const valid = barres.filter(
    ({ fret, start, end }) => fret >= 1 && inRange(start) && inRange(end),
  );
  if (valid.length < barres.length) {
    log.warn(
      'invalid-value',
      `${String(barres.length - valid.length)} chord barres span strings or frets the diagram lacks; dropped`,
      here,
    );
  }
  if (valid.length > 0) {
    diagram.barres = valid.map(({ fret, start, end }) => ({
      fret,
      firstString: Math.min(start, end),
      lastString: Math.max(start, end),
    }));
  }
  const fingering = diagram.frets.map((_, i) => FINGERS[fingers[i] ?? -1] ?? null);
  if (fingering.some((finger) => finger !== null)) diagram.fingering = fingering;
  return { name, diagram };
}

/**
 * GP's stroke speed byte as the note value the stroke spreads over: the six choices of the
 * stroke dialog, from a 128th (1) to a quarter (6).
 */
const STROKE_DURATIONS: Readonly<Record<number, NonNullable<Stroke['duration']>>> = {
  1: 128,
  2: 64,
  3: 32,
  4: 16,
  5: 8,
  6: 4,
};

/** Beat-effect bits that Guitar Pro means per note, applied once the notes are read. */
interface NoteWideEffects {
  /** GP3's beat-level harmonic. */
  harmonic?: HarmonicKind;
  /** Bit 0x01: GP3's only vibrato; GP4 and GP5 set it alongside the notes' own vibrato flag. */
  vibrato?: boolean;
}

function readBeatEffects(context: Context, beat: Beat, location: NoteLocation): NoteWideEffects {
  const { reader, version, log } = context;
  const offset = reader.offset;
  const here = { ...location, offset };
  const flags = reader.byte();
  const flags2 = version >= 400 ? reader.byte() : 0;
  const effects = beat.effects;
  const noteWide: NoteWideEffects = {};

  // 0x02 is the beat-level "wide vibrato"; 0x01 belongs to the notes (see NoteWideEffects).
  if (hasFlag(flags, 0x02)) effects.vibrato = 'wide';
  if (hasFlag(flags, 0x01)) noteWide.vibrato = true;
  if (hasFlag(flags, 0x10)) effects.fadeIn = true;
  if (hasFlag(flags2, 0x01)) log.info('rasgueado-dropped', 'a rasgueado', here);

  if (hasFlag(flags, 0x20)) {
    const typeOffset = reader.offset;
    const type = reader.signedByte();
    // GP3 follows the type with a value: when the type is 0, the depth of a tremolo-bar dip in
    // hundredths of a tone, positive downwards (GP4 writes the same dip as points down to -100).
    const dip = version < 400 ? reader.int() : 0;
    if (type === 1) effects.tapping = true;
    else if (type === 2) effects.slapping = true;
    else if (type === 3) effects.popping = true;
    else if (type === 0 && version < 400 && dip !== 0) {
      effects.whammy = {
        kind: 'dip',
        points: [
          { position: 0, value: 0 },
          { position: 30, value: -dip / 25 },
          { position: 60, value: 0 },
        ],
      };
    } else if (type !== 0) {
      invalid(context, { ...location, offset: typeOffset }, 'tap, slap or pop', type, 'none');
    }
  }
  if (hasFlag(flags2, 0x04)) {
    const bar = readBendPoints(context);
    if (bar.points.length >= 2) {
      effects.whammy = { kind: whammyKind(bar.type), points: bar.points };
    } else {
      const where = { ...location, offset: bar.offset };
      invalid(context, where, 'tremolo bar point count', bar.points.length, 'none');
    }
  }
  if (hasFlag(flags, 0x40)) {
    // GP3 and GP4 write the down stroke first; GP5 the up stroke.
    const first = reader.byte();
    const second = reader.byte();
    const [up, down] = version >= 500 ? [first, second] : [second, first];
    const speed = up > 0 ? up : down;
    if (speed > 0) {
      const brush: Stroke = { direction: up > 0 ? 'up' : 'down' };
      const duration = STROKE_DURATIONS[speed];
      if (duration) brush.duration = duration;
      else invalid(context, here, 'stroke speed', speed, 'the default');
      effects.brush = brush;
    }
  }
  if (hasFlag(flags2, 0x02)) {
    const stroke = reader.signedByte();
    if (stroke === 1) effects.pickStroke = 'up';
    else if (stroke === 2) effects.pickStroke = 'down';
    else if (stroke !== 0) invalid(context, here, 'pick stroke', stroke, 'none');
  }
  if (version < 400) {
    if (hasFlag(flags, 0x04)) noteWide.harmonic = 'natural';
    else if (hasFlag(flags, 0x08)) noteWide.harmonic = 'artificial';
  }
  return noteWide;
}

type ChannelField = 'volume' | 'pan' | 'chorus' | 'reverb' | 'phaser' | 'tremolo';
const CHANNEL_FIELDS: readonly ChannelField[] = [
  'volume',
  'pan',
  'chorus',
  'reverb',
  'phaser',
  'tremolo',
];

/**
 * A mixer change: each field is -1 when unchanged. The transition lengths follow the values,
 * one byte per field that changed, then GP4 adds a byte of "apply to every track" bits.
 */
function readMixTable(context: Context, location: NoteLocation): MixerChange {
  const { reader, version, log } = context;
  const offset = reader.offset;
  const here = { ...location, offset };
  const mix: MixerChange = {};
  const program = reader.signedByte();
  if (version >= 500) {
    log.info('rse-dropped', 'an RSE instrument change', here);
    reader.skip(16);
  }
  const raw = CHANNEL_FIELDS.map((field) => ({ field, value: reader.signedByte() }));
  const tempoLabel = version >= 500 ? reader.intByteString('int') : '';
  const tempo = reader.int();

  const changes: Partial<Record<ChannelField, ChannelMixChange>> = {};
  for (const { field, value } of raw) {
    if (value < 0) continue;
    const change: ChannelMixChange = {
      value: controllerValue(context, value, `mixer ${field}`, here),
    };
    const duration = reader.byte();
    if (duration > 0) change.duration = duration;
    changes[field] = change;
  }
  let tempoDuration = 0;
  if (tempo >= 0) {
    tempoDuration = reader.signedByte();
    if (version >= 510 && reader.bool()) {
      log.info('hidden-tempo-dropped', 'a hidden tempo change is shown', here);
    }
  }
  if (version >= 400) {
    const allTracks = reader.byte();
    CHANNEL_FIELDS.forEach((field, bit) => {
      const change = changes[field];
      if (change && hasFlag(allTracks, 1 << bit)) change.allTracks = true;
    });
  }
  if (version >= 500) {
    const wah = reader.signedByte();
    if (wah >= 0) log.info('wah-dropped', 'a wah pedal position', here);
  }
  if (version >= 510) {
    log.info('rse-dropped', 'RSE effect names', here);
    reader.intByteString('int');
    reader.intByteString('int');
  }

  if (program >= 0) {
    if (program <= MIDI_MAX) mix.program = program;
    else invalid(context, here, 'mixer program', program, 'unchanged');
  }
  for (const field of CHANNEL_FIELDS) {
    const change = changes[field];
    if (change) mix[field] = change;
  }
  if (tempo > 0) {
    mix.tempo = { bpm: tempo };
    if (tempoLabel !== '') mix.tempo.label = tempoLabel;
    if (tempoDuration > 0) mix.tempo.duration = tempoDuration;
  } else if (tempo === 0) {
    invalid(context, here, 'mixer tempo', tempo, 'unchanged');
  }
  return mix;
}

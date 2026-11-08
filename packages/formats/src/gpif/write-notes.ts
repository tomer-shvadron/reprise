import {
  LETTERS,
  openStringPitch,
  spell,
  type Accidental,
  type BendPoint,
  type Finger,
  type HarmonicKind,
  type KeySignature,
  type NativePath,
  type Note,
  type SlideKind,
  type Track,
  type Whammy,
} from '@reprise/model';

import { bendKind, bendPoints, whammyKind, type BendProperties } from './bends';
import type { DropCollector } from './dropped';
import { writesTuning } from './write-tracks';
import type { XmlWriter } from './xml-writer';

/** gpif bend values are 100 to a whole tone, the model's quarter tones × 25. */
const VALUE_SCALE = 25;
/**
 * gpif offsets run 0 to 100 across the note, the model's positions 0 to 60. Dividing by the
 * reader's 0.6 rather than multiplying by 100 / 60 gives back the offsets it read exactly.
 */
const POSITION_SCALE = 0.6;
const EPSILON = 1e-9;

const HARMONICS: Readonly<Record<HarmonicKind, string>> = {
  natural: 'Natural',
  artificial: 'Artificial',
  tapped: 'Tap',
  pinch: 'Pinch',
  semi: 'Semi',
  feedback: 'Feedback',
};

const SLIDE_FLAGS: Readonly<Record<SlideKind, number>> = {
  shift: 1,
  legato: 2,
  outDown: 4,
  outUp: 8,
  intoFromBelow: 16,
  intoFromAbove: 32,
};

/** Guitar Pro 7 writes both hands' fingers as `P I M A C`. */
const FINGERS: Readonly<Record<Finger, string>> = {
  thumb: 'P',
  index: 'I',
  middle: 'M',
  ring: 'A',
  little: 'C',
};

const ACCIDENTAL_SIGNS: Readonly<Record<Accidental, string>> = {
  doubleFlat: 'bb',
  flat: 'b',
  natural: '',
  sharp: '#',
  doubleSharp: 'x',
};

const ALTERATION: Readonly<Record<Accidental, number>> = {
  doubleFlat: -2,
  flat: -1,
  natural: 0,
  sharp: 1,
  doubleSharp: 2,
};

const NATURAL_PITCH_CLASS = [0, 2, 4, 5, 7, 9, 11];

/**
 * `Pitch` for a stored accidental: the letter the alteration spells `midi` with, and Guitar Pro's
 * octave, which counts from MIDI 0 (C4 is octave 5). An accidental that cannot spell the pitch
 * keeps the key's spelling for the letter; the reader keeps only the accidental either way.
 */
function pitchParts(midi: number, accidental: Accidental, key: KeySignature): [string, number] {
  const natural = midi - ALTERATION[accidental];
  const index = NATURAL_PITCH_CLASS.indexOf(((natural % 12) + 12) % 12);
  if (index >= 0) return [LETTERS[index] ?? 'C', Math.floor(natural / 12)];
  const fallback = spell(midi, key);
  return [fallback.letter, fallback.octave + 1];
}

function enableProperty(xml: XmlWriter, name: string): void {
  xml.open('Property', { name });
  xml.empty('Enable');
  xml.close('Property');
}

function valueProperty(xml: XmlWriter, name: string, inner: string, value: string | number): void {
  xml.open('Property', { name });
  xml.text(inner, value);
  xml.close('Property');
}

/**
 * gpif's curve: an origin, one middle value held between one or two offsets, and a destination.
 * Returns the properties for the model's points, or undefined for a curve they cannot hold.
 */
export function curveProperties(points: readonly BendPoint[]): BendProperties | undefined {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return undefined;
  const properties: BendProperties = new Map([
    ['OriginOffset', first.position / POSITION_SCALE],
    ['OriginValue', first.value * VALUE_SCALE],
    ['DestinationOffset', last.position / POSITION_SCALE],
    ['DestinationValue', last.value * VALUE_SCALE],
  ]);
  const middle = points.slice(1, -1);
  if (middle.length > 2) return undefined;
  const [one, two] = middle;
  if (one) {
    if (two && Math.abs(two.value - one.value) > EPSILON) return undefined;
    properties.set('MiddleValue', one.value * VALUE_SCALE);
    properties.set('MiddleOffset1', one.position / POSITION_SCALE);
    if (two) properties.set('MiddleOffset2', two.position / POSITION_SCALE);
  }
  return properties;
}

/** True when the reader rebuilds exactly these points (within float noise) from the properties. */
function samePoints(properties: BendProperties, points: readonly BendPoint[]): boolean {
  const read = bendPoints(properties);
  return (
    read.length === points.length &&
    read.every((point, index) => {
      const source = points[index];
      return (
        source !== undefined &&
        Math.abs(point.position - source.position) < 1e-6 &&
        Math.abs(point.value - source.value) < 1e-6
      );
    })
  );
}

/**
 * The best gpif curve for points it cannot hold exactly: origin, destination, and the point
 * furthest from the origin as the middle value.
 */
function approximateCurve(points: readonly BendPoint[]): BendProperties {
  const first = points[0] ?? { position: 0, value: 0 };
  const last = points.at(-1) ?? { position: 60, value: 0 };
  let peak: BendPoint | undefined;
  for (const point of points.slice(1, -1)) {
    if (!peak || Math.abs(point.value - first.value) > Math.abs(peak.value - first.value))
      peak = point;
  }
  return curveProperties(peak ? [first, peak, last] : [first, last]) ?? new Map<string, number>();
}

export function writeCurve(
  xml: XmlWriter,
  prefix: 'Bend' | 'WhammyBar',
  properties: BendProperties,
): void {
  for (const [name, value] of properties) {
    valueProperty(xml, `${prefix}${name}`, 'Float', value);
  }
}

/** Whammy properties for a beat, reporting a curve or kind gpif cannot carry. */
export function whammyProperties(
  whammy: Whammy,
  path: NativePath,
  drops: DropCollector,
): BendProperties {
  const exact = curveProperties(whammy.points);
  const properties = exact ?? approximateCurve(whammy.points);
  if (
    !exact ||
    !samePoints(properties, whammy.points) ||
    whammyKind(bendPoints(properties)) !== whammy.kind
  ) {
    drops.drop(
      'whammy-shape',
      path,
      'A whammy curve or kind that gpif cannot hold (more than four points, two middle values, or a kind its curve does not show)',
    );
  }
  return properties;
}

export interface NoteWriteOptions {
  track: Track;
  key: KeySignature;
  /** Index of the note's drum articulation, on a drum track. */
  articulation?: number;
  tieOrigin: boolean;
  hopoOrigin: boolean;
  tapped: boolean;
  path: NativePath;
  drops: DropCollector;
}

/** The highest string that can play a keyboard note, for Guitar Pro's tablature view of it. */
function fingerPitched(track: Track, midi: number): [string: number, fret: number] | undefined {
  if (!writesTuning(track)) return undefined;
  const frets = track.fretCount > 0 ? track.fretCount : 24;
  for (let index = track.tuning.length - 1; index >= 0; index--) {
    const fret = midi - (track.tuning[index] ?? 0);
    if (fret >= 0 && fret <= frets) return [index, fret];
  }
  return undefined;
}

/**
 * One `Note`. Fretted notes carry gpif's string index, counted from the lowest string, and the
 * fret; drum notes their articulation; keyboard notes their MIDI value. Every note also gets its
 * `Midi` number, which Guitar Pro reads for playback.
 */
export function writeNote(xml: XmlWriter, id: number, note: Note, options: NoteWriteOptions): void {
  const { track, path, drops } = options;
  xml.open('Note', { id: String(id) });
  // Guitar Pro writes it on every note; off a drum kit it is 0.
  xml.text('InstrumentArticulation', options.articulation ?? 0);
  xml.open('Properties');

  let midi: number | undefined;
  let stringPitch: number | undefined;
  if (track.kind === 'fretted') {
    const open = openStringPitch(track, note.string);
    if (open !== undefined) {
      stringPitch = open + track.capo;
      midi = stringPitch + note.fret;
    }
  } else {
    midi = note.fret;
  }

  if (note.accidental !== undefined && midi !== undefined) {
    const [step, octave] = pitchParts(midi, note.accidental, options.key);
    xml.open('Property', { name: 'ConcertPitch' });
    xml.open('Pitch');
    xml.text('Step', step);
    xml.text('Accidental', ACCIDENTAL_SIGNS[note.accidental]);
    xml.text('Octave', octave);
    xml.close('Pitch');
    xml.close('Property');
  }
  if (track.kind === 'fretted') {
    valueProperty(xml, 'String', 'String', track.tuning.length - note.string);
    valueProperty(xml, 'Fret', 'Fret', note.fret);
  } else if (track.kind === 'pitched') {
    const fingered = fingerPitched(track, note.fret);
    if (fingered) {
      valueProperty(xml, 'String', 'String', fingered[0]);
      valueProperty(xml, 'Fret', 'Fret', fingered[1]);
    } else {
      // With no string to put it on, readers that ignore `Midi` take GP6's octave and tone.
      valueProperty(xml, 'Octave', 'Number', Math.floor(note.fret / 12));
      valueProperty(xml, 'Tone', 'Step', note.fret % 12);
    }
  }
  if (midi !== undefined) valueProperty(xml, 'Midi', 'Number', midi);
  if (options.tapped) enableProperty(xml, 'Tapped');
  if (note.harmonic) {
    valueProperty(xml, 'HarmonicType', 'HType', HARMONICS[note.harmonic.kind]);
    if (note.harmonic.value !== undefined) {
      valueProperty(xml, 'HarmonicFret', 'HFret', note.harmonic.value);
    }
  }
  if (note.dead) enableProperty(xml, 'Muted');
  if (note.palmMute) enableProperty(xml, 'PalmMuted');
  if (note.bend) {
    const exact = curveProperties(note.bend.points);
    const properties = exact ?? approximateCurve(note.bend.points);
    if (
      !exact ||
      !samePoints(properties, note.bend.points) ||
      bendKind(bendPoints(properties), note.tie) !== note.bend.kind
    ) {
      drops.drop(
        'bend-shape',
        [...path, 'bend'],
        'A bend curve or kind that gpif cannot hold (more than four points, two middle values, or a kind its curve does not show)',
      );
    }
    enableProperty(xml, 'Bended');
    writeCurve(xml, 'Bend', properties);
  }
  if (options.hopoOrigin) enableProperty(xml, 'HopoOrigin');
  if (note.hammerPull) enableProperty(xml, 'HopoDestination');
  if (note.slide && note.slide.length > 0) {
    const flags = note.slide.reduce((sum, kind) => sum | SLIDE_FLAGS[kind], 0);
    valueProperty(xml, 'Slide', 'Flags', flags);
  }
  xml.close('Properties');

  if (note.letRing) xml.empty('LetRing');
  if (note.ghost) xml.text('AntiAccent', 'Normal');
  const accent =
    (note.staccato ? 1 : 0) + (note.accent === 'heavy' ? 4 : note.accent === 'accent' ? 8 : 0);
  if (accent !== 0) xml.text('Accent', accent);
  if (note.tie || options.tieOrigin) {
    xml.empty('Tie', { origin: String(options.tieOrigin), destination: String(note.tie) });
  }
  if (note.vibrato !== 'none') xml.text('Vibrato', note.vibrato === 'wide' ? 'Wide' : 'Slight');
  if (note.trill) {
    // gpif holds the trill's other note as a MIDI value; it has no speed.
    const value = track.kind === 'fretted' ? (stringPitch ?? 0) + note.trill.fret : note.trill.fret;
    if (value > 127 || (track.kind === 'fretted' && stringPitch === undefined)) {
      drops.drop('trill-range', [...path, 'trill'], 'A trill whose other note is outside MIDI');
    } else {
      xml.text('Trill', value);
      if (note.trill.speed !== 16) {
        drops.drop(
          'trill-speed',
          [...path, 'trill', 'speed'],
          'gpif keeps no trill speed; Guitar Pro plays sixteenths',
        );
      }
    }
  }
  if (note.leftHandFinger) xml.text('LeftFingering', FINGERS[note.leftHandFinger]);
  if (note.rightHandFinger) xml.text('RightFingering', FINGERS[note.rightHandFinger]);
  xml.close('Note');
}

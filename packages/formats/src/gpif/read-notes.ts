import type { Accidental, Finger, HarmonicKind, SlideKind } from '@reprise/model';

import { bendKind, bendPoints, readFloatProperty, type BendProperties } from './bends';
import type { GpifNote, NoteFields } from './document';
import {
  child,
  childPath,
  childText,
  notModelled,
  parseFloatOr,
  parseIntOr,
  unknownElement,
  unknownValue,
} from './elements';
import type { WarningSink } from './warnings';
import type { XmlElement } from './xml';

/** Both hands share one vocabulary in gpif files: `P I M A C`, and `T 1 2 3 4` from older writers. */
const FINGERS: Readonly<Record<string, Finger>> = {
  p: 'thumb',
  t: 'thumb',
  i: 'index',
  '1': 'index',
  m: 'middle',
  '2': 'middle',
  a: 'ring',
  '3': 'ring',
  c: 'little',
  '4': 'little',
};

const HARMONICS: Readonly<Record<string, HarmonicKind>> = {
  natural: 'natural',
  artificial: 'artificial',
  pinch: 'pinch',
  tap: 'tapped',
  semi: 'semi',
  feedback: 'feedback',
};

/** `Slide/Flags` bits, lowest first. 64 and 128 are pick slides, which the model lacks. */
const SLIDE_FLAGS: readonly [number, SlideKind][] = [
  [1, 'shift'],
  [2, 'legato'],
  [4, 'outDown'],
  [8, 'outUp'],
  [16, 'intoFromBelow'],
  [32, 'intoFromAbove'],
];

const ACCIDENTALS: Readonly<Record<string, Accidental>> = {
  '': 'natural',
  '#': 'sharp',
  b: 'flat',
  x: 'doubleSharp',
  bb: 'doubleFlat',
};

function finger(sink: WarningSink, path: string, text: string): Finger | undefined {
  const found = FINGERS[text.trim().toLowerCase()];
  if (found === undefined) unknownValue(sink, path, text);
  return found;
}

/** `Accent` is a bit set: 1 staccato, 2 staccatissimo, 4 heavy accent, 8 accent, 16 tenuto. */
function readAccent(sink: WarningSink, path: string, fields: NoteFields, text: string): void {
  const flags = parseIntOr(text, 0);
  if ((flags & 1) !== 0) fields.staccato = true;
  if ((flags & 2) !== 0) notModelled(sink, `${path}[staccatissimo]`, 'Staccatissimo');
  if ((flags & 4) !== 0) fields.accent = 'heavy';
  if ((flags & 8) !== 0) fields.accent = 'accent';
  if ((flags & 16) !== 0) notModelled(sink, `${path}[tenuto]`, 'Tenuto');
  if ((flags & ~31) !== 0) unknownValue(sink, path, text);
}

function readPitchAccidental(property: XmlElement): Accidental | undefined {
  const pitch = child(property, 'Pitch');
  const text = pitch === undefined ? undefined : childText(pitch, 'Accidental');
  return text === undefined ? undefined : ACCIDENTALS[text.trim()];
}

function readProperties(
  sink: WarningSink,
  element: XmlElement,
  path: string,
  note: GpifNote,
): void {
  const bend: BendProperties = new Map();
  let bended = false;
  let transposedAccidental: Accidental | undefined;
  let concertAccidental: Accidental | undefined;
  let harmonic: HarmonicKind | undefined;
  let harmonicFret: number | undefined;

  for (const property of element.children) {
    const at = childPath(path, property);
    const name = property.attributes.get('name') ?? '';
    if (property.name !== 'Property') {
      unknownElement(sink, at);
      continue;
    }
    switch (name) {
      case 'String':
        note.string = parseIntOr(childText(property, 'String'), 0);
        break;
      case 'Fret':
        note.fret = parseIntOr(childText(property, 'Fret'), 0);
        break;
      case 'Midi':
        note.midi = parseIntOr(childText(property, 'Number'), 0);
        break;
      case 'Octave':
        note.octave = parseIntOr(childText(property, 'Number'), 0);
        break;
      case 'Tone':
        note.tone = parseIntOr(childText(property, 'Step'), 0);
        break;
      case 'ConcertPitch':
        concertAccidental = readPitchAccidental(property);
        break;
      case 'TransposedPitch':
        transposedAccidental = readPitchAccidental(property);
        break;
      case 'Tapped':
        note.tapped = true;
        break;
      case 'Muted':
        note.fields.dead = child(property, 'Enable') !== undefined;
        break;
      case 'PalmMuted':
        note.fields.palmMute = child(property, 'Enable') !== undefined;
        break;
      case 'HopoOrigin':
        note.hopoOrigin = child(property, 'Enable') !== undefined;
        break;
      case 'HopoDestination':
        note.hopoDestination = child(property, 'Enable') !== undefined;
        break;
      case 'HarmonicType': {
        const text = (childText(property, 'HType') ?? '').trim().toLowerCase();
        if (text === 'noharmonic') break;
        harmonic = HARMONICS[text];
        if (harmonic === undefined) unknownValue(sink, at, text);
        break;
      }
      case 'HarmonicFret':
        harmonicFret = parseFloatOr(childText(property, 'HFret'), 0);
        break;
      case 'Slide': {
        const flags = parseIntOr(childText(property, 'Flags'), 0);
        const slides = SLIDE_FLAGS.filter(([bit]) => (flags & bit) !== 0).map(([, kind]) => kind);
        if (slides.length > 0) note.fields.slide = slides;
        if ((flags & 192) !== 0) notModelled(sink, at, 'A pick slide');
        if ((flags & ~255) !== 0) unknownValue(sink, at, String(flags));
        break;
      }
      case 'Bended':
        bended = true;
        break;
      case 'BendOriginValue':
      case 'BendOriginOffset':
      case 'BendMiddleValue':
      case 'BendMiddleOffset1':
      case 'BendMiddleOffset2':
      case 'BendDestinationValue':
      case 'BendDestinationOffset':
        bend.set(name.slice('Bend'.length), readFloatProperty(property));
        break;
      case 'LeftHandTapped':
        notModelled(sink, at, 'Left-hand tapping');
        break;
      case 'ShowStringNumber':
        notModelled(sink, at, 'A string number shown on the staff');
        break;
      case 'Element':
      case 'Variation':
        // The drum element and variation duplicate `InstrumentArticulation`, which is read.
        break;
      default:
        unknownElement(sink, at);
    }
  }

  if (bended) {
    const points = bendPoints(bend);
    note.fields.bend = { kind: bendKind(points, note.fields.tie), points };
  }
  if (harmonic !== undefined) {
    note.fields.harmonic =
      harmonicFret === undefined ? { kind: harmonic } : { kind: harmonic, value: harmonicFret };
  }
  // The concert spelling is the sounding one, which is what `Note.accidental` spells. The
  // transposed one only differs under a chromatic transposition, which the model drops.
  const accidental = concertAccidental ?? transposedAccidental;
  if (accidental !== undefined) note.accidental = accidental;
}

export function readNote(sink: WarningSink, element: XmlElement, path: string): GpifNote {
  const note: GpifNote = {
    path,
    hopoOrigin: false,
    hopoDestination: false,
    tapped: false,
    fields: {
      tie: false,
      dead: false,
      ghost: false,
      accent: 'none',
      staccato: false,
      hammerPull: false,
      vibrato: 'none',
      palmMute: false,
      letRing: false,
    },
  };
  // The tie decides the bend kind, so it is read before the properties.
  const tie = child(element, 'Tie');
  if (tie) note.fields.tie = tie.attributes.get('destination')?.toLowerCase() === 'true';

  for (const node of element.children) {
    const at = childPath(path, node);
    const text = node.text.trim();
    switch (node.name) {
      case 'Properties':
        readProperties(sink, node, at, note);
        break;
      case 'Tie':
        break;
      case 'LetRing':
        note.fields.letRing = true;
        break;
      case 'AntiAccent':
        if (text.toLowerCase() === 'normal') note.fields.ghost = true;
        else unknownValue(sink, at, text);
        break;
      case 'Accent':
        readAccent(sink, at, note.fields, text);
        break;
      case 'Vibrato':
        if (text === 'Slight') note.fields.vibrato = 'slight';
        else if (text === 'Wide') note.fields.vibrato = 'wide';
        else unknownValue(sink, at, text);
        break;
      case 'Trill': {
        // The value is the alternate fret; gpif keeps the speed nowhere, and Guitar Pro plays
        // sixteenths, as alphaTab's reader assumes.
        const fret = parseIntOr(text, -1);
        if (fret >= 0 && fret <= 127) note.fields.trill = { fret, speed: 16 };
        else unknownValue(sink, at, text);
        break;
      }
      case 'LeftFingering': {
        const found = finger(sink, at, text);
        if (found) note.fields.leftHandFinger = found;
        break;
      }
      case 'RightFingering': {
        const found = finger(sink, at, text);
        if (found) note.fields.rightHandFinger = found;
        break;
      }
      case 'InstrumentArticulation':
        note.articulation = parseIntOr(text, 0);
        break;
      case 'Ornament':
        notModelled(sink, at, 'An ornament');
        break;
      case 'XProperties':
        notModelled(sink, at, 'Extended note properties');
        break;
      default:
        unknownElement(sink, at);
    }
  }
  return note;
}

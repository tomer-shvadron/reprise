import {
  ALTERNATE_ENDING_MAX,
  KeySignatureSchema,
  TimeSignatureSchema,
  type Clef,
  type DirectionTarget,
  type JumpKind,
  type TripletFeel,
} from '@reprise/model';

import type { GpifBar, GpifMasterBar, GpifRhythm, GpifVoice } from './document';
import {
  childPath,
  childText,
  notModelled,
  parseBool,
  parseIntOr,
  splitList,
  unknownElement,
  unknownValue,
} from './elements';
import type { WarningSink } from './warnings';
import type { XmlElement } from './xml';

const JUMPS: Readonly<Record<string, JumpKind>> = {
  DaCapo: 'daCapo',
  DaCapoAlCoda: 'dcAlCoda',
  DaCapoAlDoubleCoda: 'dcAlDoubleCoda',
  DaCapoAlFine: 'dcAlFine',
  DaSegno: 'dalSegno',
  DaSegnoAlCoda: 'dsAlCoda',
  DaSegnoAlDoubleCoda: 'dsAlDoubleCoda',
  DaSegnoAlFine: 'dsAlFine',
  DaSegnoSegno: 'dalSegnoSegno',
  DaSegnoSegnoAlCoda: 'dssAlCoda',
  DaSegnoSegnoAlDoubleCoda: 'dssAlDoubleCoda',
  DaSegnoSegnoAlFine: 'dssAlFine',
  // "Da Coda" is gpif's name for the "To Coda" sign: a jump read on the way through.
  DaCoda: 'toCoda',
  DaDoubleCoda: 'toDoubleCoda',
};

const TARGETS: Readonly<Record<string, DirectionTarget>> = {
  Segno: 'segno',
  SegnoSegno: 'segnoSegno',
  Coda: 'coda',
  DoubleCoda: 'doubleCoda',
  Fine: 'fine',
};

const TRIPLET_FEELS: Readonly<Record<string, TripletFeel>> = {
  NoTripletFeel: 'none',
  Triplet8th: 'eighth',
  Triplet16th: 'sixteenth',
  Dotted8th: 'dottedEighth',
  Dotted16th: 'dottedSixteenth',
  Scottish8th: 'scottishEighth',
  Scottish16th: 'scottishSixteenth',
};

const CLEFS: Readonly<Record<string, Clef>> = {
  G2: 'treble',
  F4: 'bass',
  C3: 'alto',
  C4: 'tenor',
  Neutral: 'percussion',
};

/** Denominators as fractions of a whole note; `Long` and `DoubleWhole` exceed the model's range. */
const NOTE_VALUES: Readonly<Record<string, number>> = {
  Long: 0.25,
  DoubleWhole: 0.5,
  Whole: 1,
  Half: 2,
  Quarter: 4,
  Eighth: 8,
  '16th': 16,
  '32nd': 32,
  '64th': 64,
  '128th': 128,
  '256th': 256,
};

function readTime(sink: WarningSink, path: string, text: string): GpifMasterBar['timeSignature'] {
  const [numerator, denominator] = text.split('/').map((part) => parseIntOr(part, Number.NaN));
  const parsed = TimeSignatureSchema.safeParse({ numerator, denominator });
  if (parsed.success) return parsed.data;
  sink.warn('invalid-value', path, `Time signature "${text}" is outside the model; read as 4/4`);
  return { numerator: 4, denominator: 4 };
}

function readKey(
  sink: WarningSink,
  element: XmlElement,
  path: string,
): GpifMasterBar['keySignature'] {
  for (const node of element.children) {
    const at = childPath(path, node);
    if (node.name === 'TransposeAs') {
      if (node.text.trim() !== 'Sharps') notModelled(sink, at, 'Transposing a key as flats');
    } else if (node.name !== 'AccidentalCount' && node.name !== 'Mode') {
      unknownElement(sink, at);
    }
  }
  const fifths = parseIntOr(childText(element, 'AccidentalCount'), 0);
  const minor = childText(element, 'Mode')?.trim().toLowerCase() === 'minor';
  const parsed = KeySignatureSchema.safeParse({ fifths, minor });
  if (parsed.success) return parsed.data;
  sink.warn(
    'invalid-value',
    path,
    `Key with ${String(fifths)} accidentals is outside the model; read as C`,
  );
  return { fifths: 0, minor };
}

function readDirections(
  sink: WarningSink,
  element: XmlElement,
  path: string,
  bar: GpifMasterBar,
): void {
  for (const node of element.children) {
    const at = childPath(path, node);
    const text = node.text.trim();
    if (node.name === 'Jump') {
      const jump = JUMPS[text];
      if (jump) bar.jumps.push(jump);
      else unknownValue(sink, at, text);
    } else if (node.name === 'Target') {
      const target = TARGETS[text];
      if (target) bar.targets.push(target);
      else unknownValue(sink, at, text);
    } else {
      unknownElement(sink, at);
    }
  }
}

function readAlternateEndings(sink: WarningSink, path: string, text: string): number[] {
  const endings: number[] = [];
  for (const part of splitList(text)) {
    const value = parseIntOr(part, 0);
    if (value >= 1 && value <= ALTERNATE_ENDING_MAX && !endings.includes(value))
      endings.push(value);
    else sink.warn('invalid-value', path, `Alternate ending "${part}" is outside 1 to 8; dropped`);
  }
  return endings.sort((a, b) => a - b);
}

export function readMasterBar(sink: WarningSink, element: XmlElement, path: string): GpifMasterBar {
  const bar: GpifMasterBar = {
    path,
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: { fifths: 0, minor: false },
    repeatStart: false,
    repeatEndCount: 0,
    alternateEndings: [],
    jumps: [],
    targets: [],
    tripletFeel: 'none',
    doubleBar: false,
    barIds: [],
  };
  for (const node of element.children) {
    const at = childPath(path, node);
    const text = node.text.trim();
    switch (node.name) {
      case 'Time':
        bar.timeSignature = readTime(sink, at, text);
        break;
      case 'Key':
        bar.keySignature = readKey(sink, node, at);
        break;
      case 'Repeat': {
        bar.repeatStart = parseBool(node.attributes.get('start'));
        if (parseBool(node.attributes.get('end'))) {
          // `count` is already the section's total plays, as `repeat.endCount` counts them.
          bar.repeatEndCount = parseIntOr(node.attributes.get('count'), 0);
          if (bar.repeatEndCount < 1) {
            sink.warn(
              'invalid-value',
              at,
              'A repeat end that plays 0 times; read as no repeat end',
            );
            bar.repeatEndCount = 0;
          }
        }
        break;
      }
      case 'AlternateEndings':
        bar.alternateEndings = readAlternateEndings(sink, at, text);
        break;
      case 'Directions':
        readDirections(sink, node, at, bar);
        break;
      case 'Section': {
        const name = childText(node, 'Text') ?? '';
        const letter = childText(node, 'Letter') ?? '';
        bar.section = letter === '' ? { name } : { name, letter };
        break;
      }
      case 'TripletFeel': {
        const feel = TRIPLET_FEELS[text];
        if (feel) bar.tripletFeel = feel;
        else unknownValue(sink, at, text);
        break;
      }
      case 'DoubleBar':
        bar.doubleBar = true;
        break;
      case 'Bars':
        bar.barIds = splitList(node.text);
        break;
      case 'FreeTime':
        notModelled(sink, at, 'Free time');
        break;
      case 'Fermatas':
        notModelled(sink, at, 'A fermata');
        break;
      case 'XProperties':
        notModelled(sink, at, 'Beam grouping and display scale');
        break;
      default:
        unknownElement(sink, at);
    }
  }
  return bar;
}

export function readBar(sink: WarningSink, element: XmlElement, path: string): GpifBar {
  const bar: GpifBar = { path, voiceIds: [] };
  for (const node of element.children) {
    const at = childPath(path, node);
    const text = node.text.trim();
    switch (node.name) {
      case 'Clef': {
        const clef = CLEFS[text];
        if (clef) bar.clef = clef;
        else unknownValue(sink, at, text);
        break;
      }
      case 'Voices':
        bar.voiceIds = splitList(node.text);
        break;
      case 'SimileMark':
        if (text === 'Simple') bar.simile = 'simple';
        else if (text === 'FirstOfDouble') bar.simile = 'firstOfDouble';
        else if (text === 'SecondOfDouble') bar.simile = 'secondOfDouble';
        else unknownValue(sink, at, text);
        break;
      case 'Ottavia':
        notModelled(sink, at, 'An ottava clef');
        break;
      case 'XProperties':
        notModelled(sink, at, 'Bar display scale');
        break;
      default:
        unknownElement(sink, at);
    }
  }
  return bar;
}

export function readVoice(sink: WarningSink, element: XmlElement, path: string): GpifVoice {
  const voice: GpifVoice = { path, beatIds: [] };
  for (const node of element.children) {
    if (node.name === 'Beats') voice.beatIds = splitList(node.text).filter((id) => id !== '-1');
    else unknownElement(sink, childPath(path, node));
  }
  return voice;
}

export function readRhythm(sink: WarningSink, element: XmlElement, path: string): GpifRhythm {
  const rhythm: GpifRhythm = { path, value: 4, dots: 0 };
  for (const node of element.children) {
    const at = childPath(path, node);
    switch (node.name) {
      case 'NoteValue': {
        const text = node.text.trim();
        const value = NOTE_VALUES[text];
        if (value === undefined) unknownValue(sink, at, text);
        else rhythm.value = value;
        break;
      }
      case 'AugmentationDot': {
        const dots = parseIntOr(node.attributes.get('count'), 0);
        if (dots >= 0 && dots <= 2) rhythm.dots = dots;
        else sink.warn('invalid-value', at, `${String(dots)} dots is outside 0 to 2; read as 2`);
        if (dots > 2) rhythm.dots = 2;
        break;
      }
      case 'PrimaryTuplet': {
        const n = parseIntOr(node.attributes.get('num'), 1);
        const of = parseIntOr(node.attributes.get('den'), 1);
        if (n >= 1 && of >= 1 && n !== of) rhythm.tuplet = { n, of };
        break;
      }
      case 'SecondaryTuplet':
        notModelled(sink, at, 'A nested tuplet');
        break;
      default:
        unknownElement(sink, at);
    }
  }
  return rhythm;
}

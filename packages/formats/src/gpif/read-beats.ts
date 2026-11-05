import { DynamicsSchema, type Stroke } from '@reprise/model';

import {
  bendPoints,
  readFloatProperty,
  whammyAttributes,
  whammyKind,
  type BendProperties,
} from './bends';
import type { GpifBeat } from './document';
import {
  child,
  childPath,
  childText,
  notModelled,
  parseIntOr,
  splitList,
  unknownElement,
  unknownValue,
} from './elements';
import type { WarningSink } from './warnings';
import type { XmlElement } from './xml';

const TREMOLO = { '1/2': 8, '1/4': 16, '1/8': 32 } as const;

function isTremoloKey(text: string): text is keyof typeof TREMOLO {
  return Object.hasOwn(TREMOLO, text);
}

type StrokeDuration = NonNullable<Stroke['duration']>;

/** A brush or arpeggio's length in MIDI ticks at 960 per quarter, as the note value it spreads over. */
const STROKE_TICKS: Readonly<Record<number, StrokeDuration>> = {
  960: 4,
  480: 8,
  240: 16,
  120: 32,
  60: 64,
  30: 128,
};

/** The stroke-length property, the one beat `XProperty` the model has a field for. */
const STROKE_LENGTH_ID = '687935489';
const BEAMING_IDS = new Set(['1124204545', '1124204546', '1124204552']);

function readXProperties(
  sink: WarningSink,
  element: XmlElement,
  path: string,
): StrokeDuration | undefined {
  let stroke: StrokeDuration | undefined;
  for (const property of element.children) {
    const at = childPath(path, property);
    const id = property.attributes.get('id');
    if (property.name !== 'XProperty' || id === undefined) {
      unknownElement(sink, at);
      continue;
    }
    if (id === STROKE_LENGTH_ID) {
      const ticks = parseIntOr(childText(property, 'Int'), 0);
      stroke = STROKE_TICKS[ticks];
      if (stroke === undefined) {
        sink.warn(
          'invalid-value',
          at,
          `A stroke length of ${String(ticks)} ticks is not a note value; dropped`,
        );
      }
    } else if (BEAMING_IDS.has(id)) {
      notModelled(sink, at, 'Beam direction and grouping');
    } else {
      notModelled(sink, at, `Extended beat property ${id}`);
    }
  }
  return stroke;
}

function direction(property: XmlElement): 'up' | 'down' {
  return childText(property, 'Direction')?.trim() === 'Up' ? 'up' : 'down';
}

function readProperties(
  sink: WarningSink,
  element: XmlElement,
  path: string,
  beat: GpifBeat,
): void {
  const whammy: BendProperties = new Map();
  let hasWhammy = false;
  for (const property of element.children) {
    const at = childPath(path, property);
    if (property.name !== 'Property') {
      unknownElement(sink, at);
      continue;
    }
    const name = property.attributes.get('name') ?? '';
    switch (name) {
      case 'Brush':
        beat.effects.brush = { direction: direction(property) };
        break;
      case 'PickStroke':
        beat.effects.pickStroke = direction(property);
        break;
      case 'Slapped':
        if (child(property, 'Enable')) beat.effects.slapping = true;
        break;
      case 'Popped':
        if (child(property, 'Enable')) beat.effects.popping = true;
        break;
      case 'VibratoWTremBar': {
        const strength = childText(property, 'Strength')?.trim() ?? '';
        if (strength === 'Slight') beat.effects.vibrato = 'slight';
        else if (strength === 'Wide') beat.effects.vibrato = 'wide';
        else unknownValue(sink, at, strength);
        break;
      }
      case 'WhammyBar':
        hasWhammy = true;
        break;
      case 'WhammyBarOriginValue':
      case 'WhammyBarOriginOffset':
      case 'WhammyBarMiddleValue':
      case 'WhammyBarMiddleOffset1':
      case 'WhammyBarMiddleOffset2':
      case 'WhammyBarDestinationValue':
      case 'WhammyBarDestinationOffset':
        whammy.set(name.slice('WhammyBar'.length), readFloatProperty(property));
        break;
      case 'WhammyBarExtend':
        notModelled(sink, at, 'A whammy bar held into the next beat');
        break;
      case 'BarreFret':
      case 'BarreString':
        notModelled(sink, at, 'A barre indication');
        break;
      case 'Rasgueado':
        notModelled(sink, at, 'Rasgueado');
        break;
      case 'PrimaryPickupVolume':
      case 'PrimaryPickupTone':
        notModelled(sink, at, 'An RSE pickup setting');
        break;
      default:
        unknownElement(sink, at);
    }
  }
  if (hasWhammy) {
    const points = bendPoints(whammy);
    beat.effects.whammy = { kind: whammyKind(points), points };
  }
}

function readLyrics(element: XmlElement): string[] | undefined {
  const lines = element.children.filter((line) => line.name === 'Line').map((line) => line.text);
  return lines.some((line) => line !== '') ? lines : undefined;
}

export function readBeat(sink: WarningSink, element: XmlElement, path: string): GpifBeat {
  const beat: GpifBeat = { path, noteIds: [], effects: {} };
  let stroke: StrokeDuration | undefined;
  for (const node of element.children) {
    const at = childPath(path, node);
    const text = node.text.trim();
    switch (node.name) {
      case 'Rhythm': {
        const ref = node.attributes.get('ref');
        if (ref !== undefined) beat.rhythmId = ref;
        break;
      }
      case 'Notes':
        beat.noteIds = splitList(node.text).filter((id) => id !== '-1');
        break;
      case 'Dynamic': {
        const parsed = DynamicsSchema.safeParse(text.toLowerCase());
        if (parsed.success) beat.dynamics = parsed.data;
        else unknownValue(sink, at, text);
        break;
      }
      case 'GraceNotes':
        if (text === 'BeforeBeat') beat.grace = 'before';
        else if (text === 'OnBeat') beat.grace = 'onBeat';
        else unknownValue(sink, at, text);
        break;
      case 'Fadding':
        // Guitar Pro's own spelling of "fading".
        if (text === 'FadeIn') beat.effects.fadeIn = true;
        else if (text === 'FadeOut') beat.effects.fadeOut = true;
        else if (text === 'VolumeSwell') beat.effects.volumeSwell = true;
        else unknownValue(sink, at, text);
        break;
      case 'Tremolo':
        if (isTremoloKey(text)) beat.effects.tremoloPicking = TREMOLO[text];
        else unknownValue(sink, at, text);
        break;
      case 'Chord':
        beat.chordId = text;
        break;
      case 'Arpeggio':
        beat.effects.arpeggio = { direction: text === 'Up' ? 'up' : 'down' };
        break;
      case 'Properties':
        readProperties(sink, node, at, beat);
        break;
      case 'FreeText':
        if (node.text !== '') beat.text = node.text;
        break;
      case 'Lyrics': {
        const lyrics = readLyrics(node);
        if (lyrics) beat.lyrics = lyrics;
        break;
      }
      case 'Whammy': {
        // GP6 writes the whammy as attributes of one element.
        const points = bendPoints(whammyAttributes(node));
        beat.effects.whammy = { kind: whammyKind(points), points };
        break;
      }
      case 'TransposedPitchStemOrientation':
      case 'ConcertPitchStemOrientation':
        // Guitar Pro writes the stem direction it computed on every beat; the user's own
        // override is `UserTransposedPitchStemOrientation`, below.
        break;
      case 'UserTransposedPitchStemOrientation':
        notModelled(sink, at, 'A stem direction override');
        break;
      case 'Hairpin':
        notModelled(sink, at, 'A hairpin');
        break;
      case 'Legato':
        notModelled(sink, at, 'A legato slur');
        break;
      case 'Ottavia':
        notModelled(sink, at, 'An ottava line');
        break;
      case 'Slashed':
        notModelled(sink, at, 'A slashed beat');
        break;
      case 'DeadSlapped':
        notModelled(sink, at, 'A dead slap');
        break;
      case 'Golpe':
        notModelled(sink, at, 'A golpe');
        break;
      case 'Wah':
        notModelled(sink, at, 'A wah pedal mark');
        break;
      case 'Timer':
        notModelled(sink, at, 'A timer');
        break;
      case 'XProperties':
        stroke = readXProperties(sink, node, at) ?? stroke;
        break;
      default:
        unknownElement(sink, at);
    }
  }
  // The length belongs to whichever stroke the beat has; alone it says nothing.
  if (stroke !== undefined) {
    if (beat.effects.brush) beat.effects.brush.duration = stroke;
    else if (beat.effects.arpeggio) beat.effects.arpeggio.duration = stroke;
  }
  return beat;
}

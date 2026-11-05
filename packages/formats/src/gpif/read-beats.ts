import { DynamicsSchema } from '@reprise/model';

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
        notModelled(sink, at, 'Beaming and stroke-length overrides');
        break;
      default:
        unknownElement(sink, at);
    }
  }
  return beat;
}

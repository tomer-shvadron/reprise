import type { Barre, Chord, ChordDiagram, Finger } from '@reprise/model';

import {
  child,
  childPath,
  notModelled,
  parseIntOr,
  unknownElement,
  unknownValue,
} from './elements';
import type { WarningSink } from './warnings';
import type { XmlElement } from './xml';

/**
 * Chord-diagram fingers. alphaTab's gpif reader expects `Rank` for the ring finger and its writer
 * emits `Ring`; both are read.
 */
const FINGERS: Readonly<Record<string, Finger | null>> = {
  Thumb: 'thumb',
  Index: 'index',
  Middle: 'middle',
  Rank: 'ring',
  Ring: 'ring',
  Pinky: 'little',
  None: null,
};

/**
 * One `Item` of a diagram or chord collection. gpif counts diagram strings from the lowest
 * (string 0), like note strings, and stores frets relative to `baseFret`, which is 0-based;
 * the model lists frets from string 1 (the highest) and keeps them absolute, with a 1-based
 * `baseFret`, as alphaTab's reader converts them.
 */
export function readChordItem(sink: WarningSink, item: XmlElement, path: string): Chord {
  const name = item.attributes.get('name') ?? '';
  const diagram = child(item, 'Diagram');
  if (!diagram) return { name };

  const at = childPath(path, diagram);
  const stringCount = parseIntOr(diagram.attributes.get('stringCount'), 6);
  const base = parseIntOr(diagram.attributes.get('baseFret'), 0);
  const index = (gpifString: number): number => stringCount - 1 - gpifString;
  const frets: (number | null)[] = Array.from({ length: stringCount }, () => null);
  const fingering: (Finger | null)[] = Array.from({ length: stringCount }, () => null);
  const byFinger = new Map<string, number[]>();

  for (const node of diagram.children) {
    const nodePath = childPath(at, node);
    switch (node.name) {
      case 'Fret': {
        const position = index(parseIntOr(node.attributes.get('string'), -1));
        if (position >= 0 && position < stringCount) {
          frets[position] = base + parseIntOr(node.attributes.get('fret'), 0);
        } else {
          sink.warn(
            'invalid-value',
            nodePath,
            'A diagram fret on a string the diagram lacks; dropped',
          );
        }
        break;
      }
      case 'Fingering':
        for (const position of node.children) {
          const fingerName = position.attributes.get('finger') ?? 'None';
          const finger = FINGERS[fingerName];
          if (finger === undefined) {
            unknownValue(sink, childPath(nodePath, position), fingerName);
            continue;
          }
          const stringAttribute = position.attributes.get('string');
          const slot = stringAttribute === undefined ? -1 : index(parseIntOr(stringAttribute, -1));
          if (finger === null || slot < 0 || slot >= stringCount) continue;
          fingering[slot] = finger;
          // A finger on several strings at one fret is a barre.
          const key = `${finger}@${String(base + parseIntOr(position.attributes.get('fret'), 0))}`;
          byFinger.set(key, [...(byFinger.get(key) ?? []), slot + 1]);
        }
        break;
      case 'Property': {
        const shown = node.attributes.get('value') !== 'false';
        if (!shown) notModelled(sink, nodePath, 'Hiding part of a chord diagram');
        break;
      }
      case 'Chord':
        notModelled(sink, nodePath, "The chord wizard's construction data");
        break;
      default:
        unknownElement(sink, nodePath);
    }
  }

  const barres: Barre[] = [];
  for (const [key, strings] of byFinger) {
    if (strings.length < 2) continue;
    const fret = Number(key.slice(key.indexOf('@') + 1));
    if (fret >= 1) {
      barres.push({ fret, firstString: Math.min(...strings), lastString: Math.max(...strings) });
    }
  }

  const result: ChordDiagram = { baseFret: base + 1, frets };
  if (fingering.some((finger) => finger !== null)) result.fingering = fingering;
  if (barres.length > 0) result.barres = barres;
  return { name, diagram: result };
}

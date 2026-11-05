import type { BendKind, BendPoint, WhammyKind } from '@reprise/model';

import { child, parseFloatOr } from './elements';
import type { XmlElement } from './xml';

/** gpif bend values are 100 to a whole tone; the model counts quarter tones. */
const VALUE_SCALE = 1 / 25;
/** gpif offsets run 0 to 100 across the note; the model's positions 0 to 60. */
const POSITION_SCALE = 0.6;
const MAX_POSITION = 60;

/**
 * The properties of one bend or whammy, keyed by the suffix after `Bend` or `WhammyBar`:
 * `OriginValue`, `OriginOffset`, `MiddleValue`, `MiddleOffset1`, `MiddleOffset2`,
 * `DestinationValue`, `DestinationOffset`. GP6 writes them as attributes of one `<Whammy>`
 * element instead; `whammyAttributes` maps those onto the same names.
 */
export type BendProperties = Map<string, number>;

export function readFloatProperty(property: XmlElement): number {
  return parseFloatOr(child(property, 'Float')?.text, 0);
}

export function whammyAttributes(element: XmlElement): BendProperties {
  const names: Record<string, string> = {
    originValue: 'OriginValue',
    originOffset: 'OriginOffset',
    middleValue: 'MiddleValue',
    middleOffset1: 'MiddleOffset1',
    middleOffset2: 'MiddleOffset2',
    destinationValue: 'DestinationValue',
    destinationOffset: 'DestinationOffset',
  };
  const properties: BendProperties = new Map();
  for (const [attribute, name] of Object.entries(names)) {
    const value = element.attributes.get(attribute);
    if (value !== undefined) properties.set(name, parseFloatOr(value, 0));
  }
  return properties;
}

const position = (offset: number): number =>
  Math.min(MAX_POSITION, Math.max(0, offset * POSITION_SCALE));

/**
 * Origin, the middle points when the file has a middle value, and destination, in that order.
 * A missing origin offset is 0 and a missing destination offset 100, as Guitar Pro draws them;
 * a middle value without offsets sits halfway, which is how alphaTab's reader places it.
 */
export function bendPoints(properties: BendProperties): BendPoint[] {
  const origin = {
    position: position(properties.get('OriginOffset') ?? 0),
    value: (properties.get('OriginValue') ?? 0) * VALUE_SCALE,
  };
  const destination = {
    position: position(properties.get('DestinationOffset') ?? 100),
    value: (properties.get('DestinationValue') ?? 0) * VALUE_SCALE,
  };
  const middleValue = properties.get('MiddleValue');
  const points: BendPoint[] = [origin];
  if (middleValue !== undefined) {
    const value = middleValue * VALUE_SCALE;
    const first = properties.get('MiddleOffset1');
    const second = properties.get('MiddleOffset2');
    if (first === undefined && second === undefined) points.push({ position: 30, value });
    if (first !== undefined) points.push({ position: position(first), value });
    if (second !== undefined) points.push({ position: position(second), value });
  }
  points.push(destination);
  return points.sort((a, b) => a.position - b.position);
}

function shape(points: BendPoint[]): { origin: number; peak: number; trough: number; end: number } {
  const values = points.map((point) => point.value);
  const origin = values[0] ?? 0;
  const end = values.at(-1) ?? 0;
  const middle = values.slice(1, -1);
  return {
    origin,
    end,
    peak: Math.max(origin, end, ...middle),
    trough: Math.min(origin, end, ...middle),
  };
}

/**
 * gpif stores bend points but no bend type, so the kind is read off the curve, as Guitar Pro's
 * own bend dialog names them; `custom` where the curve fits none. `tied` says the note continues
 * a tied one, so a falling curve is a release of the earlier bend rather than a prebend.
 */
export function bendKind(points: BendPoint[], tied: boolean): BendKind {
  const { origin, peak, trough, end } = shape(points);
  if (trough < Math.min(origin, end)) return 'custom';
  if (end > origin) {
    if (peak > end) return 'custom';
    return origin > 0 && !tied ? 'prebendBend' : 'bend';
  }
  if (end < origin) {
    if (peak > origin) return 'custom';
    return tied ? 'release' : 'prebendRelease';
  }
  if (peak > origin) return 'bendRelease';
  return origin > 0 && !tied ? 'prebend' : 'hold';
}

export function whammyKind(points: BendPoint[]): WhammyKind {
  const { origin, peak, trough, end } = shape(points);
  if (peak === trough) return 'hold';
  if (origin === end) {
    if (trough < origin && peak === origin) return 'dip';
    if (peak > origin && trough === origin) return 'invertedDip';
    return 'custom';
  }
  if (origin === 0 && end < 0 && peak === 0) return 'dive';
  if (end === 0 && origin < 0 && peak === 0) return 'releaseUp';
  if (end === 0 && origin > 0 && trough === 0) return 'releaseDown';
  return 'custom';
}

import type { Clef, Id, TimeSignature } from '@reprise/model';

import type { BarContext } from './context';
import { engraving, glyphMetrics, type GlyphName } from './metrics';
import { glyph, glyphWidth, line, type LayoutSink } from './primitives';
import type { StaffGeometry } from './staves';
import type { StaffType } from './types';

/** A staff's vertical placement, as the drawing helpers need it. */
export interface StaffBox {
  type: StaffType;
  top: number;
  bottom: number;
  geometry: StaffGeometry;
  octaveShift: number;
}

/** A clef drawn inside a system, as a change, is smaller than the one that opens it. */
export const CLEF_CHANGE_SCALE = 0.75;

/** Staff positions (0 the bottom line, 8 the top) of the line each clef's glyph sits on. */
const CLEF_POSITION: Record<Clef, number> = {
  treble: 2,
  bass: 6,
  alto: 4,
  tenor: 6,
  percussion: 4,
};

/** Key-signature staff positions in the order accidentals are added, for treble clef. */
const SHARP_POSITIONS: Record<Exclude<Clef, 'percussion'>, readonly number[]> = {
  treble: [8, 5, 9, 6, 3, 7, 4],
  bass: [6, 3, 7, 4, 1, 5, 2],
  alto: [7, 4, 8, 5, 2, 6, 3],
  tenor: [2, 6, 3, 7, 4, 8, 5],
};
const FLAT_POSITIONS: Record<Exclude<Clef, 'percussion'>, readonly number[]> = {
  treble: [4, 7, 3, 6, 2, 5, 1],
  bass: [2, 5, 1, 4, 0, 3, -1],
  alto: [3, 6, 2, 5, 1, 4, 0],
  tenor: [5, 8, 4, 7, 3, 6, 2],
};

const DIGITS: readonly GlyphName[] = [
  'timeSig0',
  'timeSig1',
  'timeSig2',
  'timeSig3',
  'timeSig4',
  'timeSig5',
  'timeSig6',
  'timeSig7',
  'timeSig8',
  'timeSig9',
];

/** `octaveShift` is written minus sounding, so a guitar's 1 is the treble clef with an 8 below. */
export function clefGlyph(clef: Clef, octaveShift: number): GlyphName {
  switch (clef) {
    case 'treble':
      if (octaveShift >= 2) return 'gClef15mb';
      if (octaveShift === 1) return 'gClef8vb';
      if (octaveShift === -1) return 'gClef8va';
      return octaveShift <= -2 ? 'gClef15ma' : 'gClef';
    case 'bass':
      if (octaveShift >= 2) return 'fClef15mb';
      if (octaveShift === 1) return 'fClef8vb';
      if (octaveShift === -1) return 'fClef8va';
      return octaveShift <= -2 ? 'fClef15ma' : 'fClef';
    case 'alto':
    case 'tenor':
      return octaveShift >= 1 ? 'cClef8vb' : 'cClef';
    case 'percussion':
      return 'unpitchedPercussionClef1';
  }
}

function tabClefGlyph(geometry: StaffGeometry): GlyphName {
  return geometry.lines >= 5 ? '6stringTabClef' : '4stringTabClef';
}

/** The glyph opening a staff, and the scale that keeps a tab clef inside its lines. */
function staffClef(staff: StaffBox, clef: Clef, space: number): { name: GlyphName; scale: number } {
  if (staff.type === 'tab') {
    const name = tabClefGlyph(staff.geometry);
    const { top, bottom } = glyphMetrics(name).bbox;
    const fits = (staff.bottom - staff.top) / ((top - bottom) * space);
    return { name, scale: Math.min(1, fits) };
  }
  const shown = staff.type === 'percussion' ? 'percussion' : clef;
  return { name: clefGlyph(shown, staff.octaveShift), scale: 1 };
}

function positionY(staff: StaffBox, position: number): number {
  return staff.bottom - (position * staff.geometry.lineSpacing) / 2;
}

export function clefWidth(staff: StaffBox, clef: Clef, space: number, scale = 1): number {
  const shown = staffClef(staff, clef, space);
  return glyphWidth(shown.name, space, shown.scale * scale);
}

export function drawClef(
  sink: LayoutSink,
  staff: StaffBox,
  clef: Clef,
  x: number,
  space: number,
  options: { scale?: number; node: Id },
): void {
  const shown = staffClef(staff, clef, space);
  const scale = shown.scale * (options.scale ?? 1);
  if (staff.type === 'tab') {
    const { top, bottom } = glyphMetrics(shown.name).bbox;
    const middle = (staff.top + staff.bottom) / 2;
    const y = middle + ((top + bottom) / 2) * space * scale;
    sink.primitives.push(glyph(shown.name, x, y, space, { scale, node: options.node }));
    return;
  }
  const position = CLEF_POSITION[staff.type === 'percussion' ? 'percussion' : clef];
  const y = positionY(staff, position);
  sink.primitives.push(glyph(shown.name, x, y, space, { scale, node: options.node }));
}

function keyAccidental(fifths: number): GlyphName {
  return fifths > 0 ? 'accidentalSharp' : 'accidentalFlat';
}

function keyStep(fifths: number, space: number): number {
  return glyphWidth(keyAccidental(fifths), space) + space * 0.1;
}

function naturalStep(space: number): number {
  return glyphWidth('accidentalNatural', space) + space * 0.1;
}

/**
 * Which of the `previous` key's accidentals a change to `fifths` cancels with naturals, as
 * indices in the order they were added: all of them when the key goes to C or changes between
 * sharps and flats, the ones dropped when it keeps fewer of the same kind.
 */
export function cancelledAccidentals(previous: number, fifths: number): number[] {
  const count = Math.abs(previous);
  if (count === 0) return [];
  const sameKind = Math.sign(previous) === Math.sign(fifths);
  const from = sameKind ? Math.min(count, Math.abs(fifths)) : 0;
  return Array.from({ length: count - from }, (_, i) => from + i);
}

/**
 * Width of a key signature with `fifths` sharps (positive) or flats, its trailing gap included,
 * after the naturals cancelling a `previous` key.
 */
export function keyWidth(fifths: number, space: number, previous = 0): number {
  const naturals = cancelledAccidentals(previous, fifths).length;
  if (fifths === 0 && naturals === 0) return 0;
  const cancel =
    naturals > 0 ? naturals * naturalStep(space) + (fifths === 0 ? 0 : space * 0.4) : 0;
  return cancel + Math.abs(fifths) * keyStep(fifths, space) + space * 0.6;
}

export function drawKey(
  sink: LayoutSink,
  staff: StaffBox,
  clef: Clef,
  fifths: number,
  x: number,
  space: number,
  node: Id,
  previous = 0,
): void {
  if (staff.type !== 'standard' || clef === 'percussion') return;
  let cursor = x;
  const naturals = cancelledAccidentals(previous, fifths);
  if (naturals.length > 0) {
    const old = (previous > 0 ? SHARP_POSITIONS : FLAT_POSITIONS)[clef];
    for (const index of naturals) {
      const position = old[index];
      if (position === undefined) continue;
      sink.primitives.push(
        glyph('accidentalNatural', cursor, positionY(staff, position), space, { node }),
      );
      cursor += naturalStep(space);
    }
    cursor += space * 0.4;
  }
  if (fifths === 0) return;
  const positions = (fifths > 0 ? SHARP_POSITIONS : FLAT_POSITIONS)[clef];
  const name = keyAccidental(fifths);
  const step = keyStep(fifths, space);
  for (const [i, position] of positions.slice(0, Math.abs(fifths)).entries()) {
    sink.primitives.push(
      glyph(name, cursor + i * step, positionY(staff, position), space, { node }),
    );
  }
}

/** Time signature digits fill a tab staff's height, up to half again their standard size. */
function timeScale(staff: StaffBox, space: number): number {
  if (staff.type !== 'tab') return 1;
  return Math.min(1.5, Math.max(1, (staff.bottom - staff.top) / (4 * space)));
}

function digits(value: number): GlyphName[] {
  const names: GlyphName[] = [];
  let rest = Math.max(0, Math.trunc(value));
  do {
    names.unshift(DIGITS[rest % 10] ?? 'timeSig0');
    rest = Math.trunc(rest / 10);
  } while (rest > 0);
  return names;
}

function digitsWidth(names: readonly GlyphName[], unit: number): number {
  return names.reduce((sum, name) => sum + glyphWidth(name, unit), 0);
}

const TIME_LEAD = 0.3;
const TIME_TRAIL = 0.8;

export function timeWidth(staff: StaffBox, signature: TimeSignature, space: number): number {
  const unit = space * timeScale(staff, space);
  const widest = Math.max(
    digitsWidth(digits(signature.numerator), unit),
    digitsWidth(digits(signature.denominator), unit),
  );
  return widest + (TIME_LEAD + TIME_TRAIL) * space;
}

export function drawTime(
  sink: LayoutSink,
  staff: StaffBox,
  signature: TimeSignature,
  x: number,
  space: number,
  node: Id,
): void {
  const scale = timeScale(staff, space);
  const unit = space * scale;
  const numerator = digits(signature.numerator);
  const denominator = digits(signature.denominator);
  const widest = Math.max(digitsWidth(numerator, unit), digitsWidth(denominator, unit));
  const middle = (staff.top + staff.bottom) / 2;
  const rows: [GlyphName[], number][] = [
    [numerator, middle - unit],
    [denominator, middle + unit],
  ];
  for (const [names, y] of rows) {
    let cursor = x + TIME_LEAD * space + (widest - digitsWidth(names, unit)) / 2;
    for (const name of names) {
      sink.primitives.push(glyph(name, cursor, y, space, { scale, node }));
      cursor += glyphWidth(name, unit);
    }
  }
}

export type EndBarline = 'single' | 'double' | 'final' | 'repeat';

export function endBarline(context: BarContext): EndBarline {
  if (context.masterBar.repeat.endCount > 0) return 'repeat';
  if (context.isLast) return 'final';
  return context.masterBar.doubleBar ? 'double' : 'single';
}

function thin(space: number): number {
  return engraving.thinBarlineThickness * space;
}
function thick(space: number): number {
  return engraving.thickBarlineThickness * space;
}
function separation(space: number): number {
  return engraving.barlineSeparation * space;
}
function thinThickSeparation(space: number): number {
  return engraving.thinThickBarlineSeparation * space;
}
function dotGap(space: number): number {
  return engraving.repeatBarlineDotSeparation * space;
}

export function endBarlineWidth(kind: EndBarline, space: number): number {
  switch (kind) {
    case 'single':
      return thin(space);
    case 'double':
      return 2 * thin(space) + separation(space);
    case 'final':
      return thin(space) + thinThickSeparation(space) + thick(space);
    case 'repeat':
      return glyphWidth('repeatDot', space) + dotGap(space) + endBarlineWidth('final', space);
  }
}

export function repeatStartWidth(space: number): number {
  return endBarlineWidth('repeat', space) + space * 0.5;
}

function vertical(sink: LayoutSink, x: number, staff: StaffBox, thickness: number, node: Id): void {
  sink.primitives.push(line(x, staff.top, x, staff.bottom, thickness, { node }));
}

/** The two dots of a repeat sign, in the staff's middle spaces. */
function repeatDots(sink: LayoutSink, x: number, staff: StaffBox, space: number, node: Id): void {
  const { lines, lineSpacing } = staff.geometry;
  const middle = (staff.top + staff.bottom) / 2;
  const offset = lines % 2 === 0 ? lineSpacing : lineSpacing / 2;
  for (const y of [middle - offset, middle + offset]) {
    sink.primitives.push(glyph('repeatDot', x, y, space, { node }));
  }
}

/** An end bar line whose right edge is `right`. */
export function drawEndBarline(
  sink: LayoutSink,
  kind: EndBarline,
  right: number,
  staff: StaffBox,
  space: number,
  node: Id,
): void {
  if (kind === 'single') {
    vertical(sink, right - thin(space) / 2, staff, thin(space), node);
    return;
  }
  if (kind === 'double') {
    vertical(sink, right - thin(space) / 2, staff, thin(space), node);
    vertical(sink, right - thin(space) * 1.5 - separation(space), staff, thin(space), node);
    return;
  }
  vertical(sink, right - thick(space) / 2, staff, thick(space), node);
  const thinX = right - thick(space) - thinThickSeparation(space) - thin(space) / 2;
  vertical(sink, thinX, staff, thin(space), node);
  if (kind === 'repeat') {
    const dotX = thinX - thin(space) / 2 - dotGap(space) - glyphWidth('repeatDot', space);
    repeatDots(sink, dotX, staff, space, node);
  }
}

/** A start repeat whose left edge is `left`. */
export function drawRepeatStart(
  sink: LayoutSink,
  left: number,
  staff: StaffBox,
  space: number,
  node: Id,
): void {
  vertical(sink, left + thick(space) / 2, staff, thick(space), node);
  const thinX = left + thick(space) + thinThickSeparation(space) + thin(space) / 2;
  vertical(sink, thinX, staff, thin(space), node);
  repeatDots(sink, thinX + thin(space) / 2 + dotGap(space), staff, space, node);
}

export function staffLines(
  sink: LayoutSink,
  staff: StaffBox,
  from: number,
  to: number,
  space: number,
  node: Id,
): void {
  const thickness = engraving.staffLineThickness * space;
  for (let i = 0; i < staff.geometry.lines; i++) {
    const y = staff.top + i * staff.geometry.lineSpacing;
    sink.primitives.push(line(from, y, to, y, thickness, { node }));
  }
}

export function thinBarline(space: number): number {
  return thin(space);
}

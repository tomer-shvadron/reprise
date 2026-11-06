import {
  PPQ,
  type DirectionTarget,
  type JumpKind,
  type MasterBar,
  type TempoMark,
} from '@reprise/model';

import { engraving, textExtent, textWidth, type GlyphName } from './metrics';
import { box, glyph, glyphWidth, polyline, rect, text, type LayoutSink } from './primitives';

const TEXT_SIZE = 1.5;
const VOLTA_TEXT_SIZE = 1.3;
const SYMBOL_SCALE = 0.8;

export const JUMP_LABELS: Record<JumpKind, string> = {
  daCapo: 'D.C.',
  dcAlCoda: 'D.C. al Coda',
  dcAlDoubleCoda: 'D.C. al Double Coda',
  dcAlFine: 'D.C. al Fine',
  dalSegno: 'D.S.',
  dsAlCoda: 'D.S. al Coda',
  dsAlDoubleCoda: 'D.S. al Double Coda',
  dsAlFine: 'D.S. al Fine',
  dalSegnoSegno: 'D.S.S.',
  dssAlCoda: 'D.S.S. al Coda',
  dssAlDoubleCoda: 'D.S.S. al Double Coda',
  dssAlFine: 'D.S.S. al Fine',
  toCoda: 'To Coda',
  toDoubleCoda: 'To Double Coda',
};

/** Targets drawn as symbols at the bar start; `fine` is a word at the bar end instead. */
const TARGET_GLYPHS: Record<Exclude<DirectionTarget, 'fine'>, GlyphName[]> = {
  segno: ['segno'],
  segnoSegno: ['segno', 'segno'],
  coda: ['coda'],
  doubleCoda: ['coda', 'coda'],
};

const TEMPO_UNITS: Record<
  NonNullable<TempoMark['unit']>,
  { glyph: GlyphName; dotted: boolean; ticks: number }
> = {
  eighth: { glyph: 'metNote8thUp', dotted: false, ticks: PPQ / 2 },
  quarter: { glyph: 'metNoteQuarterUp', dotted: false, ticks: PPQ },
  dottedQuarter: { glyph: 'metNoteQuarterUp', dotted: true, ticks: PPQ * 1.5 },
  half: { glyph: 'metNoteHalfUp', dotted: false, ticks: PPQ * 2 },
  dottedHalf: { glyph: 'metNoteHalfUp', dotted: true, ticks: PPQ * 3 },
};

/** The number shown against the mark's unit: `bpm` itself is always per quarter note. */
export function displayedBpm(mark: TempoMark): number {
  const unit = TEMPO_UNITS[mark.unit ?? 'quarter'];
  return Math.round(((mark.bpm * PPQ) / unit.ticks) * 100) / 100;
}

/** Horizontal room the bar's header markings take from its start, so neighbours never collide. */
export function headerWidth(masterBar: MasterBar, space: number): number {
  const size = TEXT_SIZE * space;
  let widest = 0;
  const { section, tempo } = masterBar;
  if (section) {
    const boxed = textWidth(section.letter ?? section.name, size) + space * 0.6;
    const named = section.letter !== undefined && section.name !== '';
    widest = Math.max(widest, boxed + (named ? space * 0.5 + textWidth(section.name, size) : 0));
  }
  if (tempo) {
    const label = tempo.label ? textWidth(tempo.label, size) + space * 0.6 : 0;
    const unit = TEMPO_UNITS[tempo.unit ?? 'quarter'];
    const note =
      glyphWidth(unit.glyph, space, SYMBOL_SCALE) +
      space * 0.2 +
      (unit.dotted ? glyphWidth('metAugmentationDot', space, SYMBOL_SCALE) + space * 0.2 : 0);
    widest = Math.max(widest, label + note + textWidth(`= ${String(displayedBpm(tempo))}`, size));
  }
  const symbols = masterBar.targets
    .flatMap((target) => (target === 'fine' ? [] : TARGET_GLYPHS[target]))
    .reduce((sum, name) => sum + glyphWidth(name, space, SYMBOL_SCALE) + space * 0.2, 0);
  const words = directionWords(masterBar);
  const said = words === '' ? 0 : textWidth(words, size) + space;
  widest = Math.max(widest, symbols + said);
  return widest === 0 ? 0 : widest + space * 0.8;
}

function directionWords(masterBar: MasterBar): string {
  return [
    ...(masterBar.targets.includes('fine') ? ['Fine'] : []),
    ...masterBar.jumps.map(({ kind }) => JUMP_LABELS[kind]),
  ].join('   ');
}

export interface Band {
  top: number;
  bottom: number;
}

export function drawSection(
  sink: LayoutSink,
  masterBar: MasterBar,
  x: number,
  band: Band,
  space: number,
): void {
  const { section } = masterBar;
  if (!section) return;
  const size = TEXT_SIZE * space;
  const { ascent, descent } = textExtent(size);
  const baseline = band.bottom - space * 0.9;
  const pad = space * 0.3;
  const boxed = section.letter ?? section.name;
  const boxWidth = textWidth(boxed, size) + pad * 2;
  const node = masterBar.id;
  sink.primitives.push(
    box(
      rect(x, baseline - ascent - pad, boxWidth, ascent + descent + pad * 2),
      engraving.textEnclosureThickness * space,
      { node },
    ),
    text(boxed, x + pad, baseline, size, { node }),
  );
  if (section.letter !== undefined && section.name !== '') {
    sink.primitives.push(text(section.name, x + boxWidth + space * 0.5, baseline, size, { node }));
  }
}

export function drawTempo(
  sink: LayoutSink,
  masterBar: MasterBar,
  x: number,
  band: Band,
  space: number,
): void {
  const mark = masterBar.tempo;
  if (!mark) return;
  const size = TEXT_SIZE * space;
  const baseline = band.bottom - space * 0.8;
  const node = masterBar.id;
  let cursor = x;
  if (mark.label !== undefined && mark.label !== '') {
    sink.primitives.push(text(mark.label, cursor, baseline, size, { node }));
    cursor += textWidth(mark.label, size) + space * 0.6;
  }
  const unit = TEMPO_UNITS[mark.unit ?? 'quarter'];
  sink.primitives.push(glyph(unit.glyph, cursor, baseline, space, { scale: SYMBOL_SCALE, node }));
  cursor += glyphWidth(unit.glyph, space, SYMBOL_SCALE) + space * 0.2;
  if (unit.dotted) {
    sink.primitives.push(
      glyph('metAugmentationDot', cursor, baseline - space * 0.4, space, {
        scale: SYMBOL_SCALE,
        node,
      }),
    );
    cursor += glyphWidth('metAugmentationDot', space, SYMBOL_SCALE) + space * 0.2;
  }
  sink.primitives.push(text(`= ${String(displayedBpm(mark))}`, cursor, baseline, size, { node }));
}

export function drawDirections(
  sink: LayoutSink,
  masterBar: MasterBar,
  left: number,
  right: number,
  band: Band,
  space: number,
): void {
  const node = masterBar.id;
  let cursor = left;
  const baseline = band.bottom - space * 0.6;
  for (const target of masterBar.targets) {
    if (target === 'fine') continue;
    for (const name of TARGET_GLYPHS[target]) {
      sink.primitives.push(glyph(name, cursor, baseline, space, { scale: SYMBOL_SCALE, node }));
      cursor += glyphWidth(name, space, SYMBOL_SCALE) + space * 0.2;
    }
  }
  const words = directionWords(masterBar);
  if (words !== '') {
    sink.primitives.push(
      text(words, right, baseline, TEXT_SIZE * space, {
        anchor: 'end',
        italic: true,
        node,
      }),
    );
  }
}

/** One stretch of a volta bracket within a system. */
export interface VoltaSpan {
  masterBar: MasterBar;
  left: number;
  right: number;
  /** The bracket begins here rather than continuing from the previous system. */
  opens: boolean;
  /** The bracket ends here with a repeat, so it gets a closing hook. */
  closes: boolean;
}

export function drawVolta(sink: LayoutSink, span: VoltaSpan, band: Band, space: number): void {
  const y = band.top + space * 0.6;
  const hook = band.bottom - space * 0.2;
  const left = span.left + space * 0.2;
  const right = span.right - space * 0.4;
  const points: [number, number][] = [
    ...(span.opens ? [[left, hook] satisfies [number, number]] : []),
    [left, y],
    [right, y],
    ...(span.closes ? [[right, hook] satisfies [number, number]] : []),
  ];
  const node = span.masterBar.id;
  sink.primitives.push(polyline(points, engraving.repeatEndingLineThickness * space, { node }));
  if (span.opens) {
    const label = span.masterBar.alternateEndings.map((n) => `${String(n)}.`).join(', ');
    sink.primitives.push(
      text(label, left + space * 0.5, y + space * 1.5, VOLTA_TEXT_SIZE * space, { node }),
    );
  }
}

export function repeatCount(
  sink: LayoutSink,
  masterBar: MasterBar,
  right: number,
  lane: Band,
  space: number,
): void {
  const plays = masterBar.repeat.endCount;
  if (plays <= 2) return;
  sink.primitives.push(
    text(`x${String(plays)}`, right, lane.bottom - space * 0.35, VOLTA_TEXT_SIZE * space, {
      anchor: 'end',
      node: masterBar.id,
    }),
  );
}

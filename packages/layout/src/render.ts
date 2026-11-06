import type { MasterBar, Score } from '@reprise/model';

import { COURTESY_LEAD, NAME_SIZE, type SystemPlan } from './breaking';
import type { BarContext } from './context';
import {
  CLEF_CHANGE_SCALE,
  clefWidth,
  drawClef,
  drawEndBarline,
  drawKey,
  drawRepeatStart,
  drawTime,
  keyWidth,
  staffLines,
  thinBarline,
  type StaffBox,
} from './furniture';
import { drawDirections, drawSection, drawTempo, drawVolta, repeatCount } from './header';
import type { Band, VoltaSpan } from './header';
import { onsetIndex, type BarMeasure } from './measure';
import { textExtent } from './metrics';
import type { ResolvedOptions } from './options';
import { line, rect, round, text, type LayoutSink } from './primitives';
import { staffBar, trackBar, type StaffSlot } from './slots';
import { stretch } from './spacing';
import type { LaneBands, NeighbourBar } from './staves';
import type { Rect, StaffPlacement } from './types';
import type { VerticalLayout } from './vertical';

export interface SystemInput {
  score: Score;
  contexts: readonly BarContext[];
  measures: readonly BarMeasure[];
  slots: readonly StaffSlot[];
  options: ResolvedOptions;
  plan: SystemPlan;
  vertical: VerticalLayout;
  /** Top left corner of the system box. */
  x: number;
  y: number;
  index: number;
  id: string;
}

export interface RenderedSystem {
  bbox: Rect;
  staves: StaffPlacement[];
}

const PREFIX_LEAD = 0.5;
const CLEF_TRAIL = 0.8;

/** One bar's horizontal extent in the system, shared by every staff. */
interface Column {
  barX: number;
  contentX: number;
  contentWidth: number;
  barEnd: number;
  onsetX: (tick: number) => number;
}

function columns(input: SystemInput, from: number): (Column | undefined)[] {
  const { measures, plan } = input;
  const out: (Column | undefined)[] = [];
  let barX = from;
  for (let index = plan.start; index < plan.end; index++) {
    const measure = measures[index];
    if (!measure) {
      out.push(undefined);
      continue;
    }
    const opens = plan.opensLine && index === plan.start;
    const signatures =
      (opens ? 0 : measure.clefChange + measure.keyChange) + measure.time + measure.repeatStart;
    const contentX = barX + signatures;
    const positions: number[] = [];
    let onset = contentX + measure.leading;
    for (const segment of stretch(measure.springs, plan.factor)) {
      positions.push(onset);
      onset += segment;
    }
    const contentWidth = onset + measure.trailing - contentX;
    const barEnd = contentX + contentWidth + measure.end;
    out.push({
      barX,
      contentX,
      contentWidth,
      barEnd,
      onsetX: (tick) => positions[onsetIndex(measure.onsets, tick)] ?? contentX,
    });
    barX = barEnd;
  }
  return out;
}

function neighbour(column: Column | undefined): NeighbourBar | undefined {
  return column && { x: column.contentX, width: column.contentWidth, onsetX: column.onsetX };
}

function sameEndings(a: MasterBar | undefined, b: MasterBar | undefined): boolean {
  if (!a || !b || a.alternateEndings.length !== b.alternateEndings.length) return false;
  return a.alternateEndings.every((n, i) => b.alternateEndings[i] === n);
}

function band(
  vertical: VerticalLayout,
  row: keyof VerticalLayout['rows'],
  y: number,
): Band | undefined {
  const found = vertical.rows[row];
  return found && { top: y + found.top, bottom: y + found.bottom };
}

/** A staff slot's lanes, moved from system offsets to absolute y. */
function laneBands(vertical: VerticalLayout, slot: number, y: number): LaneBands {
  const bands: Record<string, Band> = {};
  for (const [lane, found] of Object.entries(vertical.staves[slot]?.lanes ?? {})) {
    bands[lane] = { top: y + found.top, bottom: y + found.bottom };
  }
  return bands;
}

export function renderSystem(input: SystemInput, sink: LayoutSink): RenderedSystem {
  const { score, contexts, measures, slots, options, plan, vertical } = input;
  const { space } = options;
  const x0 = input.x + plan.indent;
  const xEnd = x0 + plan.prefix + plan.width + plan.courtesy;
  const boxes: StaffBox[] = slots.map((slot, i) => {
    const offsets = vertical.staves[i] ?? { top: 0, bottom: 0 };
    return { ...slot.box, top: input.y + offsets.top, bottom: input.y + offsets.bottom };
  });
  const firstBox = boxes[0];
  const lastBox = boxes.at(-1);
  const firstExtent = vertical.staves[0];
  const lastExtent = vertical.staves.at(-1);
  const columnTop = (firstBox?.top ?? input.y) - (firstExtent?.above ?? 0);
  const columnBottom = (lastBox?.bottom ?? input.y) + (lastExtent?.below ?? 0);

  if (plan.indent > 0) {
    const size = NAME_SIZE * space;
    const { ascent } = textExtent(size);
    for (const [g, { track }] of options.tracks.entries()) {
      const group = vertical.groups[g];
      const name = plan.first ? track.name : track.shortName;
      if (!group || name === '') continue;
      const middle = input.y + (group.top + group.bottom) / 2;
      sink.primitives.push(text(name, input.x, middle + ascent / 2, size, { node: track.id }));
    }
  }

  for (const [i, slot] of slots.entries()) {
    const staff = boxes[i];
    if (staff) staffLines(sink, staff, x0, xEnd, space, slot.visible.track.id);
  }

  const startContext = contexts[plan.start];
  const firstMasterBar = startContext?.masterBar;
  if (plan.opensLine && firstBox && lastBox && firstMasterBar) {
    // A single staff opens without a bar line; two or more are joined by one.
    if (boxes.length > 1) {
      sink.primitives.push(
        line(
          x0 + thinBarline(space) / 2,
          firstBox.top,
          x0 + thinBarline(space) / 2,
          lastBox.bottom,
          thinBarline(space),
          { node: firstMasterBar.id },
        ),
      );
    }
    const clefColumn = Math.max(
      0,
      ...slots.map((slot) =>
        clefWidth(slot.box, startContext.clefs[slot.group] ?? 'treble', space),
      ),
    );
    for (const [i, slot] of slots.entries()) {
      const staff = boxes[i];
      if (!staff) continue;
      const clef = startContext.clefs[slot.group] ?? 'treble';
      drawClef(sink, staff, clef, x0 + PREFIX_LEAD * space, space, { node: slot.visible.track.id });
      drawKey(
        sink,
        staff,
        clef,
        firstMasterBar.keySignature.fifths,
        x0 + (PREFIX_LEAD + CLEF_TRAIL) * space + clefColumn,
        space,
        firstMasterBar.id,
      );
    }
  }

  const bars = columns(input, x0 + plan.prefix);
  let volta: VoltaSpan | undefined;
  const voltaBand = band(vertical, 'volta', input.y);
  for (let index = plan.start; index < plan.end; index++) {
    const measure = measures[index];
    const context = contexts[index];
    const column = bars[index - plan.start];
    if (!measure || !context || !column) continue;
    const { masterBar } = context;
    const { barX, barEnd } = column;
    const opens = plan.opensLine && index === plan.start;
    let cursor = barX;

    if (!opens && measure.clefChange > 0) {
      for (const [i, slot] of slots.entries()) {
        const staff = boxes[i];
        if (!staff || slot.type !== 'standard' || !context.clefChanges[slot.group]) continue;
        drawClef(sink, staff, context.clefs[slot.group] ?? 'treble', cursor + space * 0.3, space, {
          scale: CLEF_CHANGE_SCALE,
          node: masterBar.id,
        });
      }
      cursor += measure.clefChange;
    }
    if (!opens && measure.keyChange > 0) {
      for (const [i, slot] of slots.entries()) {
        const staff = boxes[i];
        if (!staff) continue;
        const clef = context.clefs[slot.group] ?? 'treble';
        drawKey(
          sink,
          staff,
          clef,
          masterBar.keySignature.fifths,
          cursor + space * 0.3,
          space,
          masterBar.id,
          score.masterBars[index - 1]?.keySignature.fifths,
        );
      }
      cursor += measure.keyChange;
    }
    if (measure.time > 0) {
      for (const staff of boxes)
        drawTime(sink, staff, masterBar.timeSignature, cursor, space, masterBar.id);
      cursor += measure.time;
    }
    if (measure.repeatStart > 0) {
      for (const staff of boxes) drawRepeatStart(sink, cursor, staff, space, masterBar.id);
    }

    const previous = neighbour(bars[index - plan.start - 1]);
    const next = neighbour(bars[index - plan.start + 1]);
    for (const [i, slot] of slots.entries()) {
      const staff = boxes[i];
      const bar = trackBar(slot, index);
      if (!staff || !bar) continue;
      const lanes = laneBands(vertical, i, input.y);
      slot.module.render(
        staffBar(score, slot, bar, context, space),
        {
          x: column.contentX,
          width: column.contentWidth,
          top: staff.top,
          bottom: staff.bottom,
          geometry: slot.geometry,
          system: input.index,
          onsetX: column.onsetX,
          ...(previous && { previous }),
          ...(next && { next }),
          lanes,
          lineStart: opens,
        },
        sink,
      );
      drawEndBarline(sink, measure.endKind, barEnd, staff, space, masterBar.id);
      const below = slots[i + 1];
      const lower = boxes[i + 1];
      if (below?.group === slot.group && lower) {
        // The bar line runs on through the gap between a track's staves; its dots stay inside them.
        const kind = measure.endKind === 'repeat' ? 'final' : measure.endKind;
        const gap: StaffBox = { ...staff, top: staff.bottom, bottom: lower.top };
        drawEndBarline(sink, kind, barEnd, gap, space, masterBar.id);
      }
    }
    const countBand = laneBands(vertical, 0, input.y).repeatCount;
    if (countBand) repeatCount(sink, masterBar, barEnd, countBand, space);

    const sectionBand = band(vertical, 'section', input.y);
    if (sectionBand) drawSection(sink, masterBar, barX + space * 0.2, sectionBand, space);
    const tempoBand = band(vertical, 'tempo', input.y);
    if (tempoBand) drawTempo(sink, masterBar, barX + space * 0.2, tempoBand, space);
    const directionBand = band(vertical, 'direction', input.y);
    if (directionBand) {
      drawDirections(
        sink,
        masterBar,
        barX + space * 0.2,
        barEnd - space * 0.2,
        directionBand,
        space,
      );
    }
    if (voltaBand && masterBar.alternateEndings.length > 0) {
      const before = score.masterBars[index - 1];
      const after = score.masterBars[index + 1];
      if (!volta) {
        volta = {
          masterBar,
          left: barX,
          right: barEnd,
          opens: !sameEndings(before, masterBar),
          closes: false,
        };
      }
      volta.right = barEnd;
      const endsHere = !sameEndings(masterBar, after);
      if (endsHere || index === plan.end - 1) {
        volta.closes = endsHere && masterBar.repeat.endCount > 0;
        drawVolta(sink, volta, voltaBand, space);
        volta = undefined;
      }
    }

    sink.anchors.push({
      kind: 'bar',
      id: masterBar.id,
      bbox: rect(barX, columnTop, barEnd - barX, columnBottom - columnTop),
      system: input.index,
      masterBar: masterBar.id,
    });
    for (const [g, { track }] of options.tracks.entries()) {
      const bar = track.bars[index];
      const group = vertical.groups[g];
      const groupSlots = slots.flatMap((slot, i) => (slot.group === g ? [i] : []));
      const top = groupSlots[0];
      const bottom = groupSlots.at(-1);
      if (!bar || !group || top === undefined || bottom === undefined) continue;
      const upper = input.y + group.top - (vertical.staves[top]?.above ?? 0);
      const lower = input.y + group.bottom + (vertical.staves[bottom]?.below ?? 0);
      sink.anchors.push({
        kind: 'bar',
        id: bar.id,
        bbox: rect(barX, upper, barEnd - barX, lower - upper),
        system: input.index,
        track: track.id,
        masterBar: masterBar.id,
      });
    }
  }

  const lastColumn = bars.at(-1);
  const nextContext = contexts[plan.end];
  if (plan.courtesy > 0 && lastColumn && nextContext) {
    const { masterBar } = nextContext;
    let cursor = lastColumn.barEnd + COURTESY_LEAD * space;
    if (nextContext.keyChange) {
      const previous = contexts[plan.end - 1]?.masterBar.keySignature.fifths;
      let widest = 0;
      for (const [i, slot] of slots.entries()) {
        const staff = boxes[i];
        if (!staff || slot.type !== 'standard') continue;
        const clef = nextContext.clefs[slot.group] ?? 'treble';
        drawKey(
          sink,
          staff,
          clef,
          masterBar.keySignature.fifths,
          cursor,
          space,
          masterBar.id,
          previous,
        );
        widest = keyWidth(masterBar.keySignature.fifths, space, previous);
      }
      cursor += widest;
    }
    if (nextContext.showTime) {
      for (const staff of boxes)
        drawTime(sink, staff, masterBar.timeSignature, cursor, space, masterBar.id);
    }
  }

  const staves: StaffPlacement[] = [];
  for (const [i, slot] of slots.entries()) {
    const staff = boxes[i];
    const extent = vertical.staves[i];
    if (!staff || !extent) continue;
    staves.push({
      track: slot.visible.track.id,
      type: slot.type,
      top: round(staff.top),
      bottom: round(staff.bottom),
    });
    sink.anchors.push({
      kind: 'staff',
      id: slot.visible.track.id,
      bbox: rect(
        x0,
        staff.top - extent.above,
        xEnd - x0,
        staff.bottom - staff.top + extent.above + extent.below,
      ),
      system: input.index,
      track: slot.visible.track.id,
      staff: slot.type,
    });
  }

  let lastEnd = xEnd;
  for (const column of bars) if (column) lastEnd = column.barEnd;
  const bbox = rect(input.x, input.y, Math.max(xEnd, lastEnd) - input.x, vertical.height);
  sink.anchors.push({ kind: 'system', id: input.id, bbox, system: input.index });
  return { bbox, staves };
}

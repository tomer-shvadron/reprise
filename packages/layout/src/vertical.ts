import type { MasterBar } from '@reprise/model';

import type { BarMeasure } from './measure';
import type { ResolvedOptions } from './options';
import type { StaffSlot } from './slots';
import {
  LANES_ABOVE,
  LANES_BELOW,
  type LaneBand,
  type LaneId,
  type LaneRequests,
} from './staves/lanes';
import { WORDS } from './staves/words';

/**
 * The bands above a system's first staff, top to bottom, for what the master bars carry. Only a
 * split system's continuation has `barNumber`, above its `volta`.
 */
export type HeaderRow = 'section' | 'tempo' | 'direction' | 'barNumber' | 'volta';

export const ROW_HEIGHT: Record<HeaderRow, number> = {
  section: 3.2,
  tempo: 3.6,
  direction: 3,
  barNumber: 2.4,
  volta: 2.6,
};

const ROWS: readonly [HeaderRow, (masterBar: MasterBar) => boolean][] = [
  ['section', (masterBar) => masterBar.section !== undefined],
  ['tempo', (masterBar) => masterBar.tempo !== undefined],
  ['direction', (masterBar) => masterBar.jumps.length > 0 || masterBar.targets.length > 0],
  ['volta', (masterBar) => masterBar.alternateEndings.length > 0],
];

/** Offsets are from the system's top edge. */
export interface VerticalLayout {
  rows: Partial<Record<HeaderRow, { top: number; bottom: number }>>;
  /** One per staff slot: its top and bottom lines, the room kept around them and its lanes. */
  staves: {
    top: number;
    bottom: number;
    above: number;
    below: number;
    lanes: Partial<Record<LaneId, LaneBand>>;
    /** Baselines of the word rows, from the system's top, on the staff that draws words; empty rows included. */
    words?: { chord: number; text: number; lyrics: number };
  }[];
  /** One per visible track: the span from its first staff's top line to its last's bottom. */
  groups: { top: number; bottom: number }[];
  height: number;
  /** Identifies the layout, so a cached system can tell whether it still fits. */
  key: string;
}

export function verticalLayout(
  masterBars: readonly MasterBar[],
  measures: readonly BarMeasure[],
  slots: readonly StaffSlot[],
  options: ResolvedOptions,
  /** Per staff slot, the lanes the system's bars ask for at the height of the tallest request. */
  lanes: readonly LaneRequests[],
): VerticalLayout {
  const { space } = options;
  const rows: VerticalLayout['rows'] = {};
  let y = 0;
  for (const [row, present] of ROWS) {
    if (!masterBars.some(present)) continue;
    rows[row] = { top: y, bottom: y + ROW_HEIGHT[row] * space };
    y += ROW_HEIGHT[row] * space;
  }

  const staves: VerticalLayout['staves'] = [];
  const groups: VerticalLayout['groups'] = [];
  for (const [i, slot] of slots.entries()) {
    let above = 0;
    let below = 0;
    for (const measure of measures) {
      const extent = measure.extents[i];
      if (!extent) continue;
      above = Math.max(above, extent.above);
      below = Math.max(below, extent.below);
    }
    const requested = lanes[i] ?? {};
    let outward = above;
    // The tab draws words, and so does a standard or percussion staff that is its track's only one.
    const draws = slot.type === 'tab' || slot.visible.staves.length === 1;
    // Where a word row that no bar asks for yet would go: beyond the lanes before it, not moving the ones after.
    let chordNear: number | undefined;
    let textNear: number | undefined;
    const upward: [LaneId, number, number][] = [];
    for (const lane of LANES_ABOVE) {
      const height = requested[lane];
      if (height === undefined) {
        if (draws && lane === 'chord') chordNear = outward;
        if (draws && lane === 'text') textNear = outward;
        continue;
      }
      upward.push([lane, outward, outward + height]);
      outward += height;
    }
    above = Math.max(slot.module.minRoom.above * space, outward);
    outward = below;
    let lyricsNear: number | undefined;
    const downward: [LaneId, number, number][] = [];
    for (const lane of LANES_BELOW) {
      const height = requested[lane];
      if (height === undefined) {
        if (draws && lane === 'lyrics') lyricsNear = outward;
        continue;
      }
      downward.push([lane, outward, outward + height]);
      outward += height;
    }
    below = Math.max(slot.module.minRoom.below * space, outward);

    const previous = slots[i - 1];
    if (previous) y += previous.group === slot.group ? options.staffGap : options.trackGap;
    y += above;
    const top = y;
    y += slot.box.bottom;
    const bands: Partial<Record<LaneId, LaneBand>> = {};
    for (const [lane, near, far] of upward) bands[lane] = { top: top - far, bottom: top - near };
    for (const [lane, near, far] of downward) bands[lane] = { top: y + near, bottom: y + far };
    let words: VerticalLayout['staves'][number]['words'];
    if (draws) {
      const lift = WORDS.lift * space;
      const nearOf = (lane: 'chord' | 'text', empty: number | undefined) => {
        const used = bands[lane];
        return used ? top - used.bottom : (empty ?? 0);
      };
      const lyricsTop = bands.lyrics ? bands.lyrics.top : y + (lyricsNear ?? 0);
      words = {
        chord: top - nearOf('chord', chordNear) - lift,
        text: top - nearOf('text', textNear) - lift,
        lyrics: lyricsTop + WORDS.lyricRow * space - WORDS.descent * space,
      };
    }
    staves.push({ top, bottom: y, above, below, lanes: bands, ...(words && { words }) });
    y += below;
    const group = groups[slot.group];
    if (group) group.bottom = y - below;
    else groups[slot.group] = { top, bottom: y - below };
  }

  const key = JSON.stringify([rows, staves]);
  return { rows, staves, groups, height: y, key };
}

import type { MasterBar } from '@reprise/model';

import type { BarMeasure } from './measure';
import type { ResolvedOptions } from './options';
import type { StaffSlot } from './slots';

/** The bands above a system's first staff, top to bottom, for what the master bars carry. */
export type HeaderRow = 'section' | 'tempo' | 'direction' | 'volta';

const ROW_HEIGHT: Record<HeaderRow, number> = {
  section: 3.2,
  tempo: 3.6,
  direction: 3,
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
  /** One per staff slot: its top and bottom lines and the room kept around them. */
  staves: { top: number; bottom: number; above: number; below: number }[];
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
    const previous = slots[i - 1];
    if (previous) y += previous.group === slot.group ? options.staffGap : options.trackGap;
    y += above;
    const top = y;
    y += slot.box.bottom;
    staves.push({ top, bottom: y, above, below });
    y += below;
    const group = groups[slot.group];
    if (group) group.bottom = y - below;
    else groups[slot.group] = { top, bottom: y - below };
  }

  const key = JSON.stringify([rows, staves]);
  return { rows, staves, groups, height: y, key };
}

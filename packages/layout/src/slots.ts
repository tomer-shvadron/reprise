import type { Bar, Score } from '@reprise/model';

import type { BarContext } from './context';
import type { StaffBox } from './furniture';
import type { ResolvedOptions, VisibleTrack } from './options';
import { STAFF_MODULES, type StaffBar, type StaffGeometry, type StaffModule } from './staves';
import type { StaffType } from './types';

/** One staff of one visible track, in top-to-bottom order across the system. */
export interface StaffSlot {
  visible: VisibleTrack;
  /** Index into `ResolvedOptions.tracks`. */
  group: number;
  type: StaffType;
  module: StaffModule;
  geometry: StaffGeometry;
  /** The staff with its top line at y = 0, for measuring. */
  box: StaffBox;
}

export function staffSlots(options: ResolvedOptions): StaffSlot[] {
  return options.tracks.flatMap((visible, group) =>
    visible.staves.map((type): StaffSlot => {
      const module = STAFF_MODULES[type];
      const geometry = module.geometry(visible.track, options.space);
      return {
        visible,
        group,
        type,
        module,
        geometry,
        box: {
          type,
          top: 0,
          bottom: (geometry.lines - 1) * geometry.lineSpacing,
          geometry,
          octaveShift: visible.track.display.octaveShift,
        },
      };
    }),
  );
}

export function trackBar(slot: StaffSlot, index: number): Bar | undefined {
  return slot.visible.track.bars[index];
}

export function staffBar(
  score: Score,
  slot: StaffSlot,
  bar: Bar,
  context: BarContext,
  space: number,
): StaffBar {
  return {
    score,
    track: slot.visible.track,
    trackIndex: slot.visible.index,
    bar,
    masterBar: context.masterBar,
    barIndex: context.index,
    clef: context.clefs[slot.group] ?? 'treble',
    keySignature: context.masterBar.keySignature,
    space,
  };
}

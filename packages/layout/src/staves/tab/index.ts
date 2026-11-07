import type { StaffModule } from '../staff-module';
import { TAB, type TabOptions } from './analysis';
import { tabLanes } from './lanes';
import { measureTab } from './measure';
import { renderTab } from './render';

export { TAB, type TabOptions } from './analysis';

/**
 * The tab staff: one line per string, fret numbers on them, and rhythm notation below (voice 1)
 * and above (the other voices when voice 1 is present), with the words a beat carries around it.
 * Under a standard staff (both mode) it shows the numbers, ties and words only.
 */
export function tabModule(options: Partial<TabOptions> = {}): StaffModule {
  const resolved: TabOptions = { tiedNotes: options.tiedNotes ?? 'parentheses' };
  return {
    type: 'tab',
    minRoom: { above: TAB.minAbove, below: TAB.beatReach },
    geometry: (track, space) => ({
      lines: track.tuning.length,
      lineSpacing: TAB.lineSpacing * space,
    }),
    measure: (input) => measureTab(input, resolved),
    lanes: (input) => tabLanes(input, resolved),
    render: (input, placement, sink) => {
      renderTab(input, placement, sink, resolved);
    },
  };
}

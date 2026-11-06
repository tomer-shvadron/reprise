import { analyseEffects } from '../effects';
import { LANE_HEIGHT, type LaneRequests } from '../lanes';
import { shownDynamics } from '../dynamics';
import type { StaffBar } from '../staff-module';
import { analyseBar, type TabOptions } from './analysis';

/** The tab's lanes: effects and words above, lyrics and, in tab mode, dynamics below. */
export function tabLanes(input: StaffBar, options: TabOptions): LaneRequests {
  const { space } = input;
  const analysed = analyseBar(input, options);
  const { rows } = analysed;
  const lanes: LaneRequests = {
    ...analyseEffects(input.bar, space, { articulations: analysed.rhythm }).lanes,
  };
  if (rows.chord > 0) lanes.chord = rows.chord;
  if (rows.fingering > 0) lanes.fingering = rows.fingering;
  if (rows.text > 0) lanes.text = rows.text;
  if (rows.lyrics > 0) lanes.lyrics = rows.lyrics;
  if (analysed.rhythm && shownDynamics(input.track, input.barIndex).size > 0) {
    lanes.dynamics = LANE_HEIGHT.tabDynamics * space;
  }
  return lanes;
}

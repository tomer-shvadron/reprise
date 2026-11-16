import { analyseEffects } from '../effects';
import { LANE_HEIGHT, mergeLanes, type LaneRequests } from '../lanes';
import { shownDynamics } from '../dynamics';
import { wordLanes } from '../words';
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
  mergeLanes(lanes, wordLanes(rows));
  if (rows.fingering > 0) lanes.fingering = rows.fingering;
  if (analysed.rhythm && shownDynamics(input.track, input.barIndex).size > 0) {
    lanes.dynamics = LANE_HEIGHT.tabDynamics * space;
  }
  return lanes;
}

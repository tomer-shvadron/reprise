import { LANE_HEIGHT, type LaneRequests } from '../lanes';
import type { StaffBar, StaffBarMeasure, StaffBarPlacement, StaffModule } from '../staff-module';
import { shownDynamics } from './dynamics';
import { MIN_ROOM, planBar, type BarPlan, type NotationOptions } from './plan';
import { renderBar } from './render';

export type { NotationOptions } from './plan';

const DEFAULTS: NotationOptions = { percussion: false, courtesyAccidentals: true };

interface Planned {
  inputs: unknown[];
  plan: BarPlan;
}

/** What a bar's plan is made from besides the bar itself. */
function planInputs(input: StaffBar): unknown[] {
  const { track, score, barIndex } = input;
  return [
    track,
    input.masterBar,
    track.bars[barIndex - 1],
    score.masterBars[barIndex - 1]?.keySignature,
    input.clef,
    input.space,
    barIndex,
  ];
}

function notationModule(type: 'standard' | 'percussion', options: NotationOptions): StaffModule {
  // `measure` and `render` see the same bar in one layout call; planning it once halves the work.
  const plans = new WeakMap<StaffBar['bar'], Planned>();
  const planned = (input: StaffBar): BarPlan => {
    const inputs = planInputs(input);
    const cached = plans.get(input.bar);
    if (cached && cached.inputs.every((value, i) => value === inputs[i])) return cached.plan;
    const plan = planBar(input, options);
    plans.set(input.bar, { inputs, plan });
    return plan;
  };
  return {
    type,
    minRoom: { above: MIN_ROOM, below: MIN_ROOM },
    geometry: (_track, space) => ({ lines: 5, lineSpacing: space }),
    measure(input: StaffBar): StaffBarMeasure {
      const plan = planned(input);
      const onsets = plan.beats.map((beat) =>
        beat.rest?.centred
          ? { tick: beat.tick, left: beat.rest.width / 2, right: beat.rest.width / 2 }
          : { tick: beat.tick, left: -beat.left, right: beat.right },
      );
      return { onsets, above: plan.above, below: plan.below };
    },
    lanes(input: StaffBar): LaneRequests {
      return shownDynamics(input.track, input.barIndex).size > 0
        ? { dynamics: LANE_HEIGHT.dynamics * input.space }
        : {};
    },
    render(input: StaffBar, placement: StaffBarPlacement, sink): void {
      renderBar(input, placement, sink, planned(input), type);
    },
  };
}

/** The five-line staff of fretted and pitched tracks. */
export function standardModule(
  options: Partial<Omit<NotationOptions, 'percussion'>> = {},
): StaffModule {
  return notationModule('standard', { ...DEFAULTS, ...options, percussion: false });
}

/** The five-line percussion staff of drum tracks. */
export function percussionModule(): StaffModule {
  return notationModule('percussion', {
    ...DEFAULTS,
    percussion: true,
    courtesyAccidentals: false,
  });
}

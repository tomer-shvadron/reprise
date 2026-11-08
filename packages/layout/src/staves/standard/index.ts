import type { Clef, Track } from '@reprise/model';

import { analyseEffects, drawLanes } from '../effects';
import { LANE_HEIGHT, mergeLanes, type LaneRequests } from '../lanes';
import type { StaffBar, StaffBarMeasure, StaffBarPlacement, StaffModule } from '../staff-module';
import { defaultClef } from '../../context';
import { glyphWidth } from '../../primitives';
import { DYNAMICS_GLYPHS, beatDynamics, reservedDynamics, shownDynamics } from '../dynamics';
import { MIN_ROOM, planBar, type BarPlan, type NotationOptions } from './plan';
import { renderBar } from './render';

export type { NotationOptions } from './plan';

/** Room kept either side of a dynamic beyond its glyph, in staff spaces. */
const DYNAMICS_SIDE = 0.2;

const DEFAULTS: NotationOptions = { percussion: false, courtesyAccidentals: true };
const TICK_EPSILON = 1e-6;

/**
 * A standard staff shown alone draws the lane effects the tab draws in both mode, articulations
 * apart, which it draws at the notes.
 */
function laneEffects(input: StaffBar, percussion: boolean) {
  if (percussion || input.staves.length > 1) return undefined;
  return analyseEffects(input.bar, input.space, { articulations: false });
}

interface Planned {
  inputs: unknown[];
  plan: BarPlan;
}

/**
 * What a bar's plan is made from besides the bar itself. Of the track, only the fields `planBar`
 * reads, which keep their objects across note edits; a new read of the track joins this list.
 */
function planInputs(input: StaffBar): unknown[] {
  const { track, score, barIndex } = input;
  return [
    track.kind,
    track.tuning,
    track.capo,
    track.display,
    input.masterBar,
    track.bars[barIndex - 1],
    score.masterBars[barIndex - 1]?.keySignature,
    input.clef,
    input.space,
    barIndex,
    input.staves.length,
  ];
}

/** The clef in force in bar `barIndex - 1`: the last one set up to it, else the track's default. */
function clefBefore(track: Track, barIndex: number): Clef {
  for (let i = barIndex - 1; i >= 0; i -= 1) {
    const set = track.bars[i]?.clef;
    if (set !== undefined) return set;
  }
  return defaultClef(track);
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
      const reserved = reservedDynamics(input.bar);
      const onsets = plan.beats.map((beat) => {
        const onset = beat.rest?.centred
          ? { tick: beat.tick, left: beat.rest.width / 2, right: beat.rest.width / 2 }
          : { tick: beat.tick, left: -beat.left, right: beat.right };
        const dynamics = reserved.has(beat.beat.id) ? beatDynamics(beat.beat) : undefined;
        if (dynamics) {
          const half = glyphWidth(DYNAMICS_GLYPHS[dynamics], input.space) / 2;
          const room = half + DYNAMICS_SIDE * input.space;
          onset.left = Math.max(onset.left, room);
          onset.right = Math.max(onset.right, room);
        }
        return onset;
      });
      for (const reserved of laneEffects(input, options.percussion)?.reserved ?? []) {
        const onset = onsets.find((o) => Math.abs(o.tick - reserved.tick) < TICK_EPSILON);
        if (!onset) continue;
        onset.left = Math.max(onset.left, reserved.left);
        onset.right = Math.max(onset.right, reserved.right);
      }
      return { onsets, above: plan.above, below: plan.below };
    },
    lanes(input: StaffBar): LaneRequests {
      const lanes: LaneRequests = { ...laneEffects(input, options.percussion)?.lanes };
      if (shownDynamics(input.track, input.barIndex).size > 0) {
        mergeLanes(lanes, { dynamics: LANE_HEIGHT.dynamics * input.space });
      }
      return lanes;
    },
    render(input: StaffBar, placement: StaffBarPlacement, sink): void {
      const { barIndex, track } = input;
      const before = track.bars[barIndex - 1];
      const masterBar = input.score.masterBars[barIndex - 1];
      const previous = () =>
        before && masterBar && placement.previous
          ? planned({
              ...input,
              bar: before,
              masterBar,
              barIndex: barIndex - 1,
              clef: input.bar.clef === undefined ? input.clef : clefBefore(track, barIndex),
              keySignature: masterBar.keySignature,
            })
          : undefined;
      renderBar(input, placement, sink, planned(input), type, previous);
      const effects = laneEffects(input, options.percussion);
      if (effects) drawLanes({ input, placement, sink, space: input.space, effects });
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

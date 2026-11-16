import {
  ARTICULATION,
  createTimeline,
  notesInRange,
  planNote,
  type NotePlan,
  type PlanInput,
} from '@reprise/audio';
import { write } from '@reprise/formats';
import { PAGE_SIZES, layout } from '@reprise/layout';
import { PPQ, beatTicks, type Id, type Score } from '@reprise/model';
import { note, noteOf, score } from '@reprise/model/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { createTestServices } from '@/test/services';

import type { BendAmount, BendShape } from './bend-presets';
import { runEffect } from './effect-commands';
import type { EffectAction } from './effects';
import type { WhammyAmount, WhammyShape } from './whammy-presets';

/**
 * WP-082's acceptance criterion: every effect in scope-v1 (and the extras of D6) can be applied
 * and removed, draws, and sounds. One row per effect, four checks each: it applies through the
 * registry as a key press would, `layout()` draws something it did not draw before, `planNote`
 * (the audio package's articulation plan, which the sampler sink plays) shows its mapping, and
 * applying it again removes it and leaves the score as it was.
 */

const SECONDS_PER_TICK = 0.5 / PPQ;

/** Guitar at 120 BPM: a note on string 3 with a note after it on the string, and a bar after. */
function base(): Score {
  const built = score()
    .tempo(120)
    .track('guitar', { display: { notation: 'both', octaveShift: 1 } });
  built
    .bar()
    .beat('4', [note(3, 7)])
    .beat('4', [note(3, 9)])
    .beat('4', [note(2, 5)])
    .beat('4', [note(3, 7)]);
  built.bar().beat('1', [note(3, 5)]);
  return built.build({ ids: 'sequential' });
}

function plansOf(built: Score): Map<Id, { plan: NotePlan; input: PlanInput }> {
  const timeline = createTimeline(built);
  const onsets = notesInRange(timeline, 0, timeline.endTick, {
    runStartTick: 0,
    limitTick: timeline.endTick,
  });
  const out = new Map<Id, { plan: NotePlan; input: PlanInput }>();
  for (const onset of onsets) {
    const input: PlanInput = {
      track: onset.track,
      note: onset.note,
      effects: onset.beat.effects,
      when: onset.tick * SECONDS_PER_TICK,
      length: onset.durationTicks * SECONDS_PER_TICK,
      beatLength: beatTicks(onset.beat) * SECONDS_PER_TICK,
      links: onset.continuations.map((link) => ({
        note: link.note,
        effects: link.beat.effects,
        when: link.tick * SECONDS_PER_TICK,
        length: beatTicks(link.beat) * SECONDS_PER_TICK,
      })),
      secondsPerTick: SECONDS_PER_TICK,
      barEnd: onset.barEndTick * SECONDS_PER_TICK,
      next: onset.next && { note: onset.next.note, when: onset.next.tick * SECONDS_PER_TICK },
    };
    out.set(onset.note.id, { plan: planNote(input), input });
  }
  return out;
}

function drawn(built: Score): string {
  const result = layout(built, {
    mode: 'paged',
    width: PAGE_SIZES.a4.width,
    zoom: 1,
    tracks: 'all',
    notation: {},
  });
  return JSON.stringify(result.primitives);
}

type Sound = (
  plan: NotePlan,
  input: PlanInput,
  plain: { plan: NotePlan; input: PlanInput },
) => void;

interface Row {
  name: string;
  how: { command: string } | { action: EffectAction };
  /** The note whose plan shows the effect: the note picked, or the one after it on its string. */
  on?: 'next';
  sounds: Sound | { todo: string };
}

/** The most the pitch curve moves away from zero over the note. */
function reach(plan: NotePlan, input: PlanInput): number {
  const { pitch } = plan;
  if (!pitch) return 0;
  let most = 0;
  for (let t = 0; t <= input.length; t += 0.002)
    most = Math.max(most, Math.abs(pitch(input.when + t)));
  return most;
}

const pitchAt =
  (plan: NotePlan, input: PlanInput) =>
  (fraction: number): number =>
    plan.pitch?.(input.when + fraction * input.beatLength) ?? 0;

const bendRow = (shape: BendShape, amount: BendAmount, semitones: number): Row => ({
  name: `bend: ${amount} ${shape}`,
  how: { command: `editor.effect.bend.${amount}.${shape}` },
  sounds: (plan, input) => {
    const at = pitchAt(plan, input);
    const raised = shape === 'prebend' || shape === 'prebendRelease';
    expect(at(0)).toBeCloseTo(raised ? semitones : 0, 1);
    if (shape === 'bend') expect(at(1)).toBeCloseTo(semitones, 1);
    if (shape === 'bendRelease') expect(at(0.5)).toBeCloseTo(semitones, 1);
    if (shape === 'bendRelease' || shape === 'prebendRelease') expect(at(1)).toBeCloseTo(0, 1);
    if (shape === 'prebend') expect(at(1)).toBeCloseTo(semitones, 1);
  },
});

const whammyRow = (shape: WhammyShape, amount: WhammyAmount, semitones: number): Row => ({
  name: `whammy: ${amount} ${shape}`,
  how: { command: `editor.effect.whammy.${amount}.${shape}` },
  sounds: (plan, input) => {
    const at = pitchAt(plan, input);
    if (shape === 'dive') expect(at(1)).toBeCloseTo(-semitones, 1);
    if (shape === 'dip') {
      expect(at(0.5)).toBeCloseTo(-semitones, 1);
      expect(at(1)).toBeCloseTo(0, 1);
    }
    if (shape === 'releaseUp') {
      expect(at(0)).toBeCloseTo(-semitones, 1);
      expect(at(1)).toBeCloseTo(0, 1);
    }
  },
});

const slideRow = (
  name: string,
  slide: 'shift' | 'legato' | 'intoFromBelow' | 'intoFromAbove' | 'outDown' | 'outUp',
  command?: string,
): Row => ({
  name: `slide: ${name}`,
  how: command ? { command } : { action: { kind: 'slide', slide } },
  sounds: (plan, input) => {
    if (slide === 'legato') {
      expect(plan.legatoInto).toBeCloseTo(input.next?.when ?? Number.NaN, 5);
    } else if (slide === 'shift') {
      // Into the next note's pitch, two semitones up.
      expect(plan.pitch?.((input.next?.when ?? 0) - 1e-6)).toBeCloseTo(2, 1);
    } else if (slide === 'intoFromBelow' || slide === 'intoFromAbove') {
      expect(plan.pitch?.(input.when)).toBeCloseTo(slide === 'intoFromBelow' ? -3 : 3, 1);
    } else {
      expect(plan.pitch?.(input.when + input.length)).toBeCloseTo(slide === 'outDown' ? -3 : 3, 1);
    }
  },
});

const velocity = (plan: NotePlan): number => plan.strikes[0]?.velocity ?? 0;

const TAPPED_LATER = '#255';

const ROWS: readonly Row[] = [
  bendRow('bend', 'full', 2),
  bendRow('bendRelease', 'full', 2),
  bendRow('prebend', 'full', 2),
  bendRow('prebendRelease', 'full', 2),
  bendRow('bend', 'quarter', 0.5),
  bendRow('prebend', 'half', 1),
  slideRow('legato', 'legato', 'editor.effect.legatoSlide'),
  slideRow('shift', 'shift'),
  slideRow('in from below', 'intoFromBelow'),
  slideRow('in from above', 'intoFromAbove'),
  slideRow('out down', 'outDown'),
  slideRow('out up', 'outUp'),
  {
    name: 'hammer-on and pull-off',
    how: { command: 'editor.effect.hammerOn' },
    on: 'next',
    sounds: (plan, input, plain) => {
      expect(plan.strikes[0]?.offset).toBe(ARTICULATION.hammerOffset);
      expect(velocity(plan)).toBeLessThan(velocity(plain.plan));
    },
  },
  {
    name: 'vibrato',
    how: { command: 'editor.effect.vibrato' },
    sounds: (plan, input) => {
      expect(reach(plan, input)).toBeCloseTo(0.25, 1);
    },
  },
  {
    name: 'wide vibrato',
    how: { command: 'editor.effect.wideVibrato' },
    sounds: (plan, input) => {
      expect(reach(plan, input)).toBeCloseTo(0.6, 1);
    },
  },
  {
    name: 'whammy-bar vibrato',
    how: { command: 'editor.effect.whammyVibrato' },
    sounds: (plan, input) => {
      expect(reach(plan, input)).toBeCloseTo(0.25, 1);
    },
  },
  {
    name: 'wide whammy-bar vibrato',
    how: { command: 'editor.effect.wideWhammyVibrato' },
    sounds: (plan, input) => {
      expect(reach(plan, input)).toBeCloseTo(0.6, 1);
    },
  },
  whammyRow('dive', 'medium', 2),
  whammyRow('dip', 'large', 4),
  whammyRow('releaseUp', 'small', 1),
  {
    name: 'palm mute',
    how: { command: 'editor.effect.palmMute' },
    sounds: (plan) => {
      expect(plan.filter).toEqual({ type: 'lowpass', frequency: ARTICULATION.palmMute.cutoff });
    },
  },
  {
    name: 'palm mute on the whole beat',
    how: { command: 'editor.effect.palmMuteBeat' },
    sounds: (plan) => {
      expect(plan.filter?.type).toBe('lowpass');
    },
  },
  {
    name: 'let ring',
    how: { command: 'editor.effect.letRing' },
    sounds: (plan, input) => {
      expect(plan.letRingUntil).toBe(input.barEnd);
    },
  },
  {
    name: 'dead note',
    how: { command: 'editor.effect.deadNote' },
    sounds: (plan) => {
      expect(plan.dead).toBe(true);
    },
  },
  {
    name: 'ghost note',
    how: { command: 'editor.effect.ghostNote' },
    sounds: (plan, input, plain) => {
      expect(velocity(plan)).toBeLessThan(velocity(plain.plan));
    },
  },
  {
    name: 'accent',
    how: { command: 'editor.effect.accent' },
    sounds: (plan, input, plain) => {
      expect(velocity(plan)).toBeGreaterThan(velocity(plain.plan));
    },
  },
  {
    name: 'heavy accent',
    how: { command: 'editor.effect.heavyAccent' },
    sounds: (plan, input, plain) => {
      expect(velocity(plan)).toBeGreaterThan(velocity(plain.plan));
    },
  },
  {
    name: 'staccato',
    how: { command: 'editor.effect.staccato' },
    sounds: (plan, input) => {
      const strike = plan.strikes[0];
      expect((strike?.end ?? 0) - (strike?.when ?? 0)).toBeCloseTo(
        input.beatLength * ARTICULATION.staccatoFraction,
        3,
      );
    },
  },
  {
    name: 'natural harmonic',
    how: { command: 'editor.effect.naturalHarmonic' },
    sounds: (plan, input, plain) => {
      expect(plan.filter?.type).toBe('highshelf');
      const key = (strike: NotePlan['strikes'][number] | undefined) =>
        (strike?.key ?? 0) + (strike?.detune ?? 0);
      expect(key(plan.strikes[0])).toBeGreaterThan(key(plain.plan.strikes[0]));
    },
  },
  ...(['artificial', 'tapped', 'pinch', 'semi', 'feedback'] as const).map((kind): Row => ({
    name: `${kind} harmonic`,
    how: { action: { kind: 'harmonic', harmonic: { kind, value: 12 } } },
    sounds: (plan, input, plain) => {
      expect(plan.filter?.type).toBe('highshelf');
      const key = (strike: NotePlan['strikes'][number] | undefined) =>
        (strike?.key ?? 0) + (strike?.detune ?? 0);
      expect(key(plan.strikes[0])).toBeGreaterThan(key(plain.plan.strikes[0]));
    },
  })),
  {
    name: 'trill',
    how: { action: { kind: 'trill', trill: { fret: 9, speed: 16 } } },
    sounds: (plan) => {
      expect(plan.strikes.length).toBeGreaterThan(1);
    },
  },
  {
    name: 'tremolo picking',
    how: { command: 'editor.effect.tremoloPicking' },
    sounds: (plan) => {
      expect(plan.strikes.length).toBeGreaterThan(1);
    },
  },
  { name: 'tapping', how: { command: 'editor.effect.tapping' }, sounds: { todo: TAPPED_LATER } },
  { name: 'slap', how: { command: 'editor.effect.slap' }, sounds: { todo: TAPPED_LATER } },
  { name: 'pop', how: { command: 'editor.effect.pop' }, sounds: { todo: TAPPED_LATER } },
  {
    name: 'pick stroke down',
    how: { command: 'editor.effect.pickStrokeDown' },
    sounds: { todo: TAPPED_LATER },
  },
  {
    name: 'pick stroke up',
    how: { command: 'editor.effect.pickStrokeUp' },
    sounds: { todo: TAPPED_LATER },
  },
  {
    name: 'brush down',
    how: { command: 'editor.effect.brushDown' },
    sounds: { todo: TAPPED_LATER },
  },
  { name: 'brush up', how: { command: 'editor.effect.brushUp' }, sounds: { todo: TAPPED_LATER } },
  {
    name: 'arpeggio down',
    how: { command: 'editor.effect.arpeggioDown' },
    sounds: { todo: TAPPED_LATER },
  },
  {
    name: 'arpeggio up',
    how: { command: 'editor.effect.arpeggioUp' },
    sounds: { todo: TAPPED_LATER },
  },
  {
    name: 'fade in',
    how: { command: 'editor.effect.fadeIn' },
    sounds: (plan) => {
      expect(plan.gain[0]?.db).toBeLessThan(-20);
      expect(plan.gain.at(-1)?.db).toBeCloseTo(0, 1);
    },
  },
  {
    name: 'fade out',
    how: { command: 'editor.effect.fadeOut' },
    sounds: (plan) => {
      expect(plan.gain[0]?.db).toBeCloseTo(0, 1);
      expect(plan.gain.at(-1)?.db).toBeLessThan(-20);
    },
  },
  {
    name: 'volume swell',
    how: { command: 'editor.effect.volumeSwell' },
    sounds: (plan) => {
      expect(plan.gain.length).toBeGreaterThanOrEqual(3);
      expect(Math.max(...plan.gain.map(({ db }) => db))).toBeCloseTo(0, 1);
      expect(plan.gain[0]?.db).toBeLessThan(-20);
    },
  },
];

async function setup() {
  const services = createTestServices();
  const registry = createAppRegistry(services);
  await services.document
    .getState()
    .openBytes('effects.reprise', (await write(base(), 'reprise')).bytes);
  services.editing.getState().setEditing(true);
  const current = (): Score => {
    const found = services.document.getState().score;
    if (!found) throw new Error('not open');
    return found;
  };
  const id = noteOf(current(), 0, 0, 0).id;
  services.selection.getState().select({ noteIds: [id] });
  return { services, registry, current, id };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('every effect applies, draws, sounds and comes off again', () => {
  for (const row of ROWS) {
    const check = async () => {
      const { services, registry, current, id } = await setup();
      const original = current();
      const originalDrawing = drawn(original);
      const originalPlans = plansOf(original);
      const targetId = row.on === 'next' ? noteOf(original, 0, 0, 1).id : id;

      const apply = () => {
        if ('command' in row.how) {
          const command = registry.get(row.how.command);
          if (!command) throw new Error(`no command ${row.how.command}`);
          void command.run();
        } else {
          runEffect(services, row.how.action);
        }
      };

      // Applies, and the status line has no refusal.
      apply();
      expect(services.entry.getState().message).toBeUndefined();
      const applied = current();
      expect(applied).not.toEqual(original);

      // Draws: the layout differs from the plain note's.
      expect(drawn(applied)).not.toBe(originalDrawing);

      // Sounds.
      if (!('todo' in row.sounds)) {
        const plans = plansOf(applied);
        const plan = plans.get(targetId);
        const plain = originalPlans.get(targetId);
        if (!plan || !plain) throw new Error('the note is not scheduled');
        row.sounds(plan.plan, plan.input, plain);
      }

      // Removes: the same key again, and the score is as it was, in layout too.
      apply();
      expect(current()).toEqual(original);
      expect(drawn(current())).toBe(originalDrawing);
      // One undo step each.
      services.document.getState().undo();
      expect(current()).toEqual(applied);
    };
    it(row.name, check, 30_000);
    if ('todo' in row.sounds) it.todo(`${row.name} sounds (${row.sounds.todo})`);
  }
});

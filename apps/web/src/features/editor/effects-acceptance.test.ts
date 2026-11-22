import {
  ARTICULATION,
  createTimeline,
  hitsInRange,
  notesInRange,
  planNote,
  type NotePlan,
  type PlanInput,
} from '@reprise/audio';
import { write } from '@reprise/formats';
import { PAGE_SIZES, layout, type Primitive } from '@reprise/layout';
import { PPQ, beatTicks, type Golpe, type Id, type Score, type SlideKind } from '@reprise/model';
import { beatOf, note, noteOf, score } from '@reprise/model/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { createTestServices } from '@/test/services';

import { bendPreset, type BendAmount, type BendShape } from './bend-presets';
import { applyEffect, commitEffectPlan, runEffect } from './effect-commands';
import { effectInput } from './effect-dialogs';
import type { EffectAction } from './effects';
import { planGrace, type GraceForm } from './grace-form';
import { whammyPreset, type WhammyAmount, type WhammyShape } from './whammy-presets';

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

/**
 * What `planNote` makes of each note the audio timeline schedules. The `PlanInput` is built here
 * by hand from the onset, as the sampler sink builds it from a `NoteEvent` (which passes `note`
 * and `beat.effects` straight through), so a "sounds" check proves the articulation mapping of
 * the effect the editor wrote, not the sink's own wiring (the audio package tests that). A tied
 * link's length here is its beat's, where the sink uses the link's own; no row ties notes.
 */
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

function drawn(built: Score): Primitive[] {
  return layout(built, {
    mode: 'paged',
    width: PAGE_SIZES.a4.width,
    zoom: 1,
    tracks: 'all',
    notation: {},
  }).primitives;
}

/** `kind:label@node` of each primitive, without its coordinates, which every mark shifts. */
function signatures(primitives: readonly Primitive[]): string[] {
  return primitives.map((primitive) => {
    const label =
      primitive.kind === 'text'
        ? primitive.text
        : primitive.kind === 'glyph'
          ? primitive.glyph
          : '';
    return `${primitive.kind}:${label}@${primitive.node ?? ''}`;
  });
}

/**
 * Checks that the effect added its own mark on the note or its neighbour: each entry of `marks`
 * (`text:P.M.`, `glyph:ornamentTrill`, `path`, or alternatives joined by `|`) names a primitive
 * of a node of the first two beats that the plain score did not have.
 */
function expectMarks(
  before: readonly Primitive[],
  after: readonly Primitive[],
  nodes: ReadonlySet<string>,
  marks: readonly string[],
): void {
  const remaining = signatures(before);
  const added = signatures(after).filter((signature) => {
    const at = remaining.indexOf(signature);
    if (at < 0) return true;
    remaining.splice(at, 1);
    return false;
  });
  for (const mark of marks) {
    const alternatives = mark.split('|');
    const found = added.some((signature) => {
      const [what = '', node = ''] = signature.split('@');
      return (
        nodes.has(node) &&
        alternatives.some(
          (alternative) =>
            what === alternative ||
            (!alternative.includes(':') && what.startsWith(`${alternative}:`)),
        )
      );
    });
    expect(found, `layout draws ${mark}; it added ${added.join(', ')}`).toBe(true);
  }
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
  /** The marks layout draws for it, found among the primitives of the first two beats. */
  draws: readonly string[];
  /** `hit`: a golpe is no note, so the timeline's `hitsInRange` schedules it instead of `planNote`. */
  sounds: Sound | { todo: string } | { hit: Golpe };
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
  draws: ['text:full|text:½|text:¼', 'path'],
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
  draws: ['text:w/bar', 'path'],
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
  draws: slide === 'legato' ? ['text:sl.', 'path'] : ['path|line'],
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

const SILENT_UNTIL = '#255';

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
    draws: ['text:H'],
    how: { command: 'editor.effect.hammerOn' },
    on: 'next',
    sounds: (plan, input, plain) => {
      expect(plan.strikes[0]?.offset).toBe(ARTICULATION.hammerOffset);
      expect(velocity(plan)).toBeLessThan(velocity(plain.plan));
    },
  },
  {
    name: 'vibrato',
    draws: ['path'],
    how: { command: 'editor.effect.vibrato' },
    sounds: (plan, input) => {
      expect(reach(plan, input)).toBeCloseTo(0.25, 1);
    },
  },
  {
    name: 'wide vibrato',
    draws: ['path'],
    how: { command: 'editor.effect.wideVibrato' },
    sounds: (plan, input) => {
      expect(reach(plan, input)).toBeCloseTo(0.6, 1);
    },
  },
  {
    name: 'whammy-bar vibrato',
    draws: ['path'],
    how: { command: 'editor.effect.whammyVibrato' },
    sounds: (plan, input) => {
      expect(reach(plan, input)).toBeCloseTo(0.25, 1);
    },
  },
  {
    name: 'wide whammy-bar vibrato',
    draws: ['path'],
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
    draws: ['text:P.M.'],
    how: { command: 'editor.effect.palmMute' },
    sounds: (plan) => {
      expect(plan.filter).toEqual({ type: 'lowpass', frequency: ARTICULATION.palmMute.cutoff });
    },
  },
  {
    name: 'palm mute on the whole beat',
    draws: ['text:P.M.'],
    how: { command: 'editor.effect.palmMuteBeat' },
    sounds: (plan) => {
      expect(plan.filter?.type).toBe('lowpass');
    },
  },
  {
    name: 'let ring',
    draws: ['text:let ring'],
    how: { command: 'editor.effect.letRing' },
    sounds: (plan, input) => {
      expect(plan.letRingUntil).toBe(input.barEnd);
    },
  },
  {
    name: 'dead note',
    draws: ['text:x'],
    how: { command: 'editor.effect.deadNote' },
    sounds: (plan) => {
      expect(plan.dead).toBe(true);
    },
  },
  {
    name: 'ghost note',
    draws: ['text:(7)'],
    how: { command: 'editor.effect.ghostNote' },
    sounds: (plan, input, plain) => {
      expect(velocity(plan)).toBeLessThan(velocity(plain.plan));
    },
  },
  {
    name: 'accent',
    draws: ['glyph:articAccentAbove'],
    how: { command: 'editor.effect.accent' },
    sounds: (plan, input, plain) => {
      expect(velocity(plan)).toBeGreaterThan(velocity(plain.plan));
    },
  },
  {
    name: 'heavy accent',
    draws: ['glyph:articMarcatoAbove'],
    how: { command: 'editor.effect.heavyAccent' },
    sounds: (plan, input, plain) => {
      expect(velocity(plan)).toBeGreaterThan(velocity(plain.plan));
    },
  },
  {
    name: 'staccato',
    draws: ['glyph:articStaccatoAbove'],
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
    draws: ['text:N.H.'],
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
    draws: ['text'],
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
    draws: ['glyph:ornamentTrill'],
    how: { action: { kind: 'trill', trill: { fret: 9, speed: 16 } } },
    sounds: (plan) => {
      expect(plan.strikes.length).toBeGreaterThan(1);
    },
  },
  {
    name: 'tremolo picking',
    draws: ['glyph:tremolo3'],
    how: { command: 'editor.effect.tremoloPicking' },
    sounds: (plan) => {
      expect(plan.strikes.length).toBeGreaterThan(1);
    },
  },
  {
    name: 'tapping',
    draws: ['text:T'],
    how: { command: 'editor.effect.tapping' },
    sounds: { todo: SILENT_UNTIL },
  },
  {
    name: 'slap',
    draws: ['text:S'],
    how: { command: 'editor.effect.slap' },
    sounds: { todo: SILENT_UNTIL },
  },
  {
    name: 'pop',
    draws: ['text:P'],
    how: { command: 'editor.effect.pop' },
    sounds: { todo: SILENT_UNTIL },
  },
  {
    name: 'golpe (thumb)',
    draws: ['glyph:guitarGolpe'],
    how: { command: 'editor.effect.golpeThumb' },
    sounds: { hit: 'thumb' },
  },
  {
    name: 'golpe (finger)',
    draws: ['glyph:guitarGolpe'],
    how: { command: 'editor.effect.golpeFinger' },
    sounds: { hit: 'finger' },
  },
  {
    name: 'pick scrape down',
    draws: ['text:P.S.', 'path'],
    how: { command: 'editor.effect.pickScrapeDown' },
    sounds: (plan) => {
      expect(plan.scrape).toBe('down');
    },
  },
  {
    name: 'pick scrape up',
    draws: ['text:P.S.', 'path'],
    how: { command: 'editor.effect.pickScrapeUp' },
    sounds: (plan) => {
      expect(plan.scrape).toBe('up');
    },
  },
  {
    name: 'pick stroke down',
    draws: ['glyph:stringsDownBow'],
    how: { command: 'editor.effect.pickStrokeDown' },
    sounds: { todo: SILENT_UNTIL },
  },
  {
    name: 'pick stroke up',
    draws: ['glyph:stringsUpBow'],
    how: { command: 'editor.effect.pickStrokeUp' },
    sounds: { todo: SILENT_UNTIL },
  },
  {
    name: 'brush down',
    draws: ['path'],
    how: { command: 'editor.effect.brushDown' },
    sounds: { todo: SILENT_UNTIL },
  },
  {
    name: 'brush up',
    draws: ['path'],
    how: { command: 'editor.effect.brushUp' },
    sounds: { todo: SILENT_UNTIL },
  },
  {
    name: 'arpeggio down',
    draws: ['path'],
    how: { command: 'editor.effect.arpeggioDown' },
    sounds: { todo: SILENT_UNTIL },
  },
  {
    name: 'arpeggio up',
    draws: ['path'],
    how: { command: 'editor.effect.arpeggioUp' },
    sounds: { todo: SILENT_UNTIL },
  },
  {
    name: 'fade in',
    draws: ['glyph:guitarFadeIn'],
    how: { command: 'editor.effect.fadeIn' },
    sounds: (plan) => {
      expect(plan.gain[0]?.db).toBeLessThan(-20);
      expect(plan.gain.at(-1)?.db).toBeCloseTo(0, 1);
    },
  },
  {
    name: 'fade out',
    draws: ['glyph:guitarFadeOut'],
    how: { command: 'editor.effect.fadeOut' },
    sounds: (plan) => {
      expect(plan.gain[0]?.db).toBeCloseTo(0, 1);
      expect(plan.gain.at(-1)?.db).toBeLessThan(-20);
    },
  },
  {
    name: 'volume swell',
    draws: ['glyph:guitarVolumeSwell'],
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

      // Draws its own mark on the note or its neighbour.
      const appliedDrawing = drawn(applied);
      expect(appliedDrawing).not.toEqual(originalDrawing);
      const nodes = new Set<string>([
        ...[0, 1].flatMap((beat) => [
          beatOf(original, 0, 0, beat).id,
          noteOf(original, 0, 0, beat).id,
        ]),
      ]);
      expectMarks(originalDrawing, appliedDrawing, nodes, row.draws);

      // Sounds.
      if ('hit' in row.sounds) {
        const timeline = createTimeline(applied);
        const hits = hitsInRange(timeline, 0, timeline.endTick, {
          runStartTick: 0,
          limitTick: timeline.endTick,
        });
        expect(hits.map((hit) => [hit.beatIndex, hit.golpe])).toEqual([[0, row.sounds.hit]]);
      } else if (!('todo' in row.sounds)) {
        const plans = plansOf(applied);
        const plan = plans.get(targetId);
        const plain = originalPlans.get(targetId);
        if (!plan || !plain) throw new Error('the note is not scheduled');
        row.sounds(plan.plan, plan.input, plain);
      }

      // Removes: the same key again, and the score is as it was, in layout too.
      apply();
      expect(current()).toEqual(original);
      expect(drawn(current())).toEqual(originalDrawing);
      // One undo step each.
      services.document.getState().undo();
      expect(current()).toEqual(applied);
    };
    it(row.name, check, 30_000);
    if ('todo' in row.sounds) it.todo(`${row.name} sounds (${row.sounds.todo})`);
  }
});

/**
 * The grace-note dialog's outcomes, which no key applies: a grace note before the beat, one on
 * it, and each transition. Same four checks. "Sounds" is the scheduler's: a grace note before the
 * beat hands the beat out early by its length (the sampler sink then plays the grace ahead of
 * `when`, which the audio package tests), and one on the beat does not.
 */
describe('grace notes apply, draw, sound and come off again', () => {
  const FORM: GraceForm = { fret: 7, duration: 32, before: true, transition: 'none', dead: false };
  const cases: readonly { name: string; form: GraceForm }[] = [
    { name: 'before the beat', form: FORM },
    { name: 'on the beat', form: { ...FORM, before: false } },
    { name: 'a slide into the note', form: { ...FORM, transition: 'slide' } },
    { name: 'a hammer-on to the note', form: { ...FORM, transition: 'hammer' } },
    { name: 'a dead grace note', form: { ...FORM, dead: true } },
  ];
  for (const { name, form } of cases) {
    it(
      name,
      async () => {
        const { services, current } = await setup();
        const original = current();
        // The second beat: string 3, fret 9, with a beat before it to lead into.
        const target = noteOf(original, 0, 0, 1);
        services.selection.getState().select({ noteIds: [target.id] });
        const input = effectInput(services);
        if (!input) throw new Error('not open');
        const plan = planGrace(input, form);
        expect(commitEffectPlan(services, plan)).toEqual({ applied: true });
        const applied = current();
        const grace = beatOf(applied, 0, 0, 1).grace?.[0];
        expect(grace).toMatchObject({ before: form.before, duration: 32 });
        const graceNote = grace?.notes[0];
        expect(graceNote).toMatchObject({ string: 3, fret: 7, dead: form.dead });

        // Draws: the grace note is a node of its own in the drawing.
        const drawing = drawn(applied);
        expect(drawing.length).toBeGreaterThan(drawn(original).length);
        expect(drawing.some((primitive) => primitive.node === graceNote?.id)).toBe(true);

        // Sounds: a grace before the beat makes the scheduler hand the beat out early.
        const timeline = createTimeline(applied);
        const lead = beatTicks({ duration: 32, dots: 0 });
        const early = notesInRange(timeline, PPQ - lead, PPQ, {
          runStartTick: 0,
          limitTick: timeline.endTick,
        });
        expect(early.some((onset) => onset.note.id === target.id)).toBe(form.before);
        if (form.transition === 'hammer') {
          expect(noteOf(applied, 0, 0, 1).hammerPull).toBe(true);
        }

        // Removes: the dialog's Remove clears the grace note and the hammer flag it owned.
        const removal = planGrace(effectInput(services) ?? input, 'remove');
        expect(commitEffectPlan(services, removal)).toEqual({ applied: true });
        expect(current()).toEqual(original);
        services.document.getState().undo();
        expect(current()).toEqual(applied);
      },
      30_000,
    );
  }
});

describe('the pickers apply, replace and remove', () => {
  it('replaces one bend with another and removes it, as the picker does', async () => {
    const { services, current, id } = await setup();
    const original = current();
    const bend = (kind: BendShape, amount: BendAmount): EffectAction => ({
      kind: 'bend',
      bend: bendPreset(kind, amount),
    });
    expect(applyEffect(services, bend('bend', 'full'), 'set')).toEqual({ applied: true });
    expect(applyEffect(services, bend('prebend', 'half'), 'set')).toEqual({ applied: true });
    expect(noteOf(current(), 0, 0, 0).bend).toEqual(bendPreset('prebend', 'half'));
    // Setting what is already there changes nothing.
    expect(applyEffect(services, bend('prebend', 'half'), 'set')).toEqual({ nothing: true });
    expect(applyEffect(services, bend('bend', 'full'), 'remove')).toEqual({ applied: true });
    expect(current()).toEqual(original);
    expect(id).toBe(noteOf(original, 0, 0, 0).id);
  });

  it('replaces a harmonic of one kind with another, and Remove takes any off', async () => {
    const { services, current } = await setup();
    const original = current();
    const harmonic = (kind: 'artificial' | 'tapped', value: number): EffectAction => ({
      kind: 'harmonic',
      harmonic: { kind, value },
    });
    applyEffect(services, harmonic('artificial', 12), 'set');
    applyEffect(services, harmonic('tapped', 7), 'set');
    expect(noteOf(current(), 0, 0, 0).harmonic).toEqual({ kind: 'tapped', value: 7 });
    applyEffect(services, { kind: 'harmonic', harmonic: { kind: 'natural' } }, 'remove');
    expect(current()).toEqual(original);
  });

  it('keeps the slide groups apart: one way in and one way out', async () => {
    const { services, current } = await setup();
    const slide = (kind: SlideKind): EffectAction => ({ kind: 'slide', slide: kind });
    applyEffect(services, slide('outDown'), 'toggle');
    applyEffect(services, slide('intoFromBelow'), 'toggle');
    applyEffect(services, slide('outUp'), 'toggle');
    expect([...(noteOf(current(), 0, 0, 0).slide ?? [])].sort()).toEqual([
      'intoFromBelow',
      'outUp',
    ]);
  });

  it('puts a whammy on a beat and removes it whatever its shape', async () => {
    const { services, current } = await setup();
    const original = current();
    applyEffect(services, { kind: 'whammy', whammy: whammyPreset('dive', 'medium') }, 'set');
    applyEffect(services, { kind: 'whammy', whammy: whammyPreset('dip', 'small') }, 'set');
    expect(beatOf(current(), 0, 0, 0).effects.whammy?.kind).toBe('dip');
    applyEffect(services, { kind: 'whammy', whammy: whammyPreset('dive', 'large') }, 'remove');
    expect(current()).toEqual(original);
  });
});

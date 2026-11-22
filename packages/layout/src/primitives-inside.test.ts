import { note, score } from '@reprise/model/testing';
import { assert, constant, constantFrom, integer, oneof, property, tuple } from 'fast-check';
import { describe, expect, inject, it } from 'vitest';

import { parseNative, type Bend, type Notation, type Score } from '@reprise/model';

import {
  DEFAULT_MARGINS,
  PAGE_SIZES,
  layout,
  type LayoutOptions,
  type LayoutResult,
} from './index';
import { expectValid, overlappingMarks } from './test/check-result';
import { randomScore } from './test/random-score';

const EPSILON = 0.02;

// The package compiles against ES2022 alone, which declares no TextEncoder.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

declare module 'vitest' {
  export interface ProvidedContext {
    scoreFixtures: { path: string; native: string }[];
  }
}

/**
 * Primitives, as `kind node`, that reach past the right edge of the system drawing them. Only the
 * right edge: continuous segments draw a few markings (pedal and track names) left of their
 * frame on purpose, in the margin.
 */
function outside(result: LayoutResult): string[] {
  const found: string[] = [];
  for (const system of result.systems) {
    const right = system.bbox.x - (system.offsetX ?? 0) + system.bbox.width;
    for (const primitive of result.primitives.slice(
      system.primitives.start,
      system.primitives.end,
    )) {
      const { x, width } = primitive.bbox;
      if (x + width > right + EPSILON) found.push(`${primitive.kind} ${primitive.node ?? '-'}`);
    }
  }
  return found;
}

/** Pairs of `full` bend labels that overlap: random scores bend to nothing else. */
function fullLabelOverlaps(result: LayoutResult): string[] {
  return overlappingMarks(result)
    .filter(
      ([a, b]) => a.kind === 'text' && b.kind === 'text' && a.text === 'full' && b.text === 'full',
    )
    .map(([a, b]) => `${a.node ?? '-'} ${b.node ?? '-'}`);
}

/** Systems, as `index`, that end right of the line, the page width less the right margin. */
function lineOverflow(result: LayoutResult, width: number): number[] {
  const line = width - DEFAULT_MARGINS.paged.right;
  return result.systems
    .filter((system) => system.bbox.x + system.bbox.width > line + EPSILON)
    .map((system) => system.index);
}

function options(built: Score, width: number, notation: Notation): LayoutOptions {
  return {
    mode: 'paged',
    width,
    pageHeight: PAGE_SIZES.a4.height,
    zoom: 1,
    tracks: 'all',
    notation: Object.fromEntries(built.tracks.map(({ id }) => [id, notation])),
  };
}

type NoteSpec = NonNullable<Parameters<typeof note>[2]>;

const PREBEND: Bend = {
  kind: 'prebend',
  points: [
    { position: 0, value: 4 },
    { position: 60, value: 4 },
  ],
};
const BEND: Bend = {
  kind: 'bend',
  points: [
    { position: 0, value: 0 },
    { position: 60, value: 4 },
  ],
};

/** Twelve bars of `count` beats of `duration`, each ending on a note made from `last`. */
function endingOn(duration: '8' | '16', count: number, last: NoteSpec, fret = 5): Score {
  const built = score().track('guitar');
  for (let bar = 0; bar < 12; bar++) {
    built.bar();
    for (let i = 0; i < count - 1; i++) built.beat(duration, [note(2, (i % 5) + 1)]);
    built.beat(duration, [note(3, fret, last)]);
  }
  return built.build({ ids: 'sequential' });
}

/** The widths from `from` to `to` px, every 20, at which `built` draws past a system's edge. */
function overflowing(built: Score, notation: Notation, from: number, to: number): number[] {
  const found: number[] = [];
  for (let width = from; width <= to; width += 20) {
    if (outside(layout(built, options(built, width, notation))).length > 0) found.push(width);
  }
  return found;
}

describe('primitives stay inside their system', () => {
  it('in a squeezed bar whose last beat has a second voice moved right of it', () => {
    const first = score().track('guitar').bar();
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 0), note(2, 0), note(3, 0)]);
    first.voice(1);
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 1), note(2, 1)]);
    const built = first.build({ ids: 'sequential' });
    const result = layout(built, {
      mode: 'paged',
      width: 240,
      pageHeight: PAGE_SIZES.a4.height,
      zoom: 1,
      tracks: 'all',
      notation: Object.fromEntries(built.tracks.map(({ id }) => [id, 'standard' as const])),
    });
    expect(outside(result)).toEqual([]);
  });

  it('keeps a shifted voice inside a bar too dense for its line', () => {
    const first = score().track('guitar').bar();
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 0), note(2, 0), note(3, 0)]);
    first.voice(1);
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 1), note(2, 1)]);
    const built = first.build({ ids: 'sequential' });
    expect(outside(layout(built, options(built, 200, 'standard')))).toEqual([]);
  });

  it('keeps the voices of the dense standard bars at 320 px inside the system', () => {
    for (const seed of [16, 169, 250, 399]) {
      const built = randomScore(seed, { diagrams: true });
      const found = outside(layout(built, options(built, 320, 'standard')));
      expect(found, `seed ${String(seed)}`).toEqual([]);
    }
  });

  it('ends every paged system within its line, even where the rigid parts alone overflow it', () => {
    // Seed 399 has an onset of three voices, each shifted right of the one before: 117.8 px of
    // rigid parts against 61.7 px of room at 320 px.
    const built = randomScore(399, { diagrams: true });
    const result = layout(built, options(built, 320, 'standard'));
    // The voice shifts are drawn at `rigidScale`, so the heads fit and no anchor needs clipping.
    expectValid(result);
    expect(outside(result)).toEqual([]);
    expect(lineOverflow(result, 320)).toEqual([]);
  });

  it("keeps a harmonic's slide-out inside the bar, room counted from past its brackets", () => {
    const built = endingOn('8', 8, {
      harmonic: { kind: 'artificial', value: 12 },
      slide: ['outDown'],
    });
    expect(overflowing(built, 'tab', 300, 1200)).toEqual([]);
  });

  it("keeps a harmonic's bend inside the bar, room counted from past its brackets", () => {
    const built = endingOn('8', 8, { harmonic: { kind: 'artificial', value: 12 }, bend: BEND });
    expect(overflowing(built, 'tab', 300, 1200)).toEqual([]);
  });

  it("stops a pre-bend's hold at the bar's end in standard notation", () => {
    const built = endingOn('16', 16, { bend: PREBEND }, 12);
    expect(overflowing(built, 'standard', 300, 440)).toEqual([]);
  });

  it("keeps the sl. letter of a legato arc cut by the bar's end inside the system", () => {
    for (const seed of [53, 377]) {
      const built = randomScore(seed, { diagrams: true });
      expect(outside(layout(built, options(built, 320, 'tab'))), `seed ${String(seed)}`).toEqual(
        [],
      );
    }
  });

  it('draws bends in the dense standard bars at 320 px with a frame that ends after it starts', () => {
    for (const seed of [16, 399]) {
      const built = randomScore(seed, { diagrams: true });
      expectValid(layout(built, options(built, 320, 'standard')));
    }
  });

  it('keeps every standard seed inside its system at 320 px', () => {
    // The sampled property below covers about a seventh of the seeds per run, so the sweep is
    // exhaustive: a seed a later change breaks fails here, not on an unrelated PR.
    for (let seed = 0; seed <= 400; seed++) {
      const built = randomScore(seed, { diagrams: true });
      const result = layout(built, options(built, 320, 'standard'));
      expect(outside(result), `seed ${String(seed)}`).toEqual([]);
      expect(fullLabelOverlaps(result), `seed ${String(seed)}`).toEqual([]);
      expectValid(result);
    }
  }, 60_000);

  it('keeps every seed inside its system at 320 px with both notations shown', () => {
    // Seed 399 drew tab harmonic numbers and slide paths past the edge while the whole rigid
    // extent was scaled; seeds 59 and 250 are the other dense ones.
    const found: string[] = [];
    for (let seed = 0; seed <= 400; seed++) {
      const built = randomScore(seed, { diagrams: true });
      const result = layout(built, options(built, 320, 'both'));
      for (const entry of outside(result)) found.push(`seed ${String(seed)} ${entry}`);
      expect(lineOverflow(result, 320), `seed ${String(seed)}`).toEqual([]);
    }
    expect(found).toEqual([]);
  }, 60_000);

  it('prints no two overlapping bend labels in any tab seed at 320 px', () => {
    for (let seed = 0; seed <= 400; seed++) {
      const built = randomScore(seed, { diagrams: true });
      const result = layout(built, options(built, 320, 'tab'));
      expect(fullLabelOverlaps(result), `seed ${String(seed)}`).toEqual([]);
    }
  }, 60_000);

  it('holds for random scores in paged mode at narrow and wide lines', () => {
    // Paged only: continuous mode never squeezes (`finish` squeezes only paged lines), so it
    // could not reach the squeezed cases this guards.
    assert(
      property(
        integer({ min: 0, max: 400 }),
        oneof(
          tuple(constant(320), constantFrom<Notation>('tab', 'standard', 'both')),
          tuple(constantFrom(500, 700, 1200), constantFrom<Notation>('tab', 'standard', 'both')),
        ),
        (seed, [width, notation]) => {
          const built = randomScore(seed, { diagrams: true });
          const result = layout(built, options(built, width, notation));
          const label = `seed ${String(seed)} ${String(width)} ${notation}`;
          expect(outside(result), label).toEqual([]);
          expect(lineOverflow(result, width), label).toEqual([]);
        },
      ),
      { numRuns: 240 },
    );
  }, 60_000);

  it('keeps every fixture inside its system at 320 px in every notation', () => {
    // The random scores draw no whammy bar and few bends, so the corpus holds the labels the
    // sweep cannot reach (a whammy's `-½`, a bend's `1½`).
    const found: string[] = [];
    const fixtures = inject('scoreFixtures');
    expect(fixtures.length).toBeGreaterThan(0);
    for (const { path, native } of fixtures) {
      const built = parseNative(new TextEncoder().encode(native)).score;
      for (const notation of ['tab', 'standard', 'both'] as const) {
        const result = layout(built, options(built, 320, notation));
        for (const entry of outside(result)) found.push(`${path} ${notation} ${entry}`);
      }
    }
    expect(found).toEqual([]);
  }, 120_000);
});

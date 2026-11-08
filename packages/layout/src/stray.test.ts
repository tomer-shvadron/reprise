import { parseNative, type Notation, type Score } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { assert, integer, property } from 'fast-check';
import { describe, expect, inject, it } from 'vitest';

import { PAGE_SIZES, layout, type LayoutOptions } from './index';
import { strayPrimitives } from './test/check-result';
import { describePrimitive } from './test/describe';
import { withEffects, withNoteMarks } from './test/effects';
import { randomScore } from './test/random-score';

// The package compiles against ES2022 alone, which declares no TextEncoder.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

/** What `scripts/fixtures/provide-scores.ts` provides: each fixture read in Node, as a native document. */
interface ScoreFixture {
  path: string;
  native: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    scoreFixtures: ScoreFixture[];
  }
}

const fixtures = inject('scoreFixtures');

function read(native: string): Score {
  return parseNative(new TextEncoder().encode(native)).score;
}

type Mode = 'paged' | 'continuous' | 'paged at 400 px high';
const NOTATIONS: readonly Notation[] = ['tab', 'standard', 'both'];
const MODES: readonly Mode[] = ['paged', 'continuous', 'paged at 400 px high'];

/** Every track at `notation`, except pitched tracks, which keep their own (#125). */
function optionsFor(built: Score, notation: Notation, mode: Mode): LayoutOptions {
  return {
    mode: mode === 'continuous' ? 'continuous' : 'paged',
    width: mode === 'continuous' ? 640 : PAGE_SIZES.a4.width,
    ...(mode === 'paged at 400 px high' && { pageHeight: 400 }),
    zoom: 1,
    tracks: 'all',
    notation: Object.fromEntries(
      built.tracks.map((track) => [
        track.id,
        track.kind === 'pitched' ? track.display.notation : notation,
      ]),
    ),
  };
}

function strays(
  built: Score,
  notations: readonly Notation[] = NOTATIONS,
  modes: readonly Mode[] = MODES,
): string[] {
  const found: string[] = [];
  for (const notation of notations) {
    for (const mode of modes) {
      const result = layout(built, optionsFor(built, notation, mode));
      for (const primitive of strayPrimitives(result, built)) {
        found.push(`${notation}, ${mode}: ${describePrimitive(primitive)}`);
      }
    }
  }
  return found;
}

/** Raise locally to soak; 50 keeps the unit suite fast. */
const RUNS = 50;

describe('stray primitives', () => {
  it('reads the corpus', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(`none in ${fixture.path}`, () => {
      expect(strays(read(fixture.native))).toEqual([]);
    });
  }

  it('none in the large score with effects and note marks', () => {
    const built = withNoteMarks(withEffects(largeScore(3, 32, { structure: true })));
    expect(strays(built)).toEqual([]);
  });

  it(
    'none in the long score with effects in standard and both notation',
    { timeout: 30_000 },
    () => {
      const built = withEffects(largeScore(8, 300, { structure: true }));
      expect(strays(built, ['standard', 'both'], ['paged', 'continuous'])).toEqual([]);
    },
  );

  it('none in random scores', () => {
    assert(
      property(integer({ min: 1, max: 0x7fffffff }), (seed) => {
        expect(strays(randomScore(seed), NOTATIONS, ['paged', 'continuous'])).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });
});

import { parseNative, type Notation, type Score } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, inject, it } from 'vitest';

import { PAGE_SIZES, layout, type LayoutOptions, type StaffType } from './index';
import { strayPrimitives } from './test/check-result';
import { describePrimitive } from './test/describe';
import { withEffects, withNoteMarks } from './test/effects';

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
  staves: readonly StaffType[],
  notations: readonly Notation[] = NOTATIONS,
  modes: readonly Mode[] = MODES,
): string[] {
  const found: string[] = [];
  for (const notation of notations) {
    for (const mode of modes) {
      const result = layout(built, optionsFor(built, notation, mode));
      for (const staff of staves) {
        for (const primitive of strayPrimitives(result, built, staff)) {
          found.push(`${notation}, ${mode}: ${describePrimitive(primitive)}`);
        }
      }
    }
  }
  return found;
}

describe('stray primitives on the tab staff', () => {
  it('reads the corpus', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(`none in ${fixture.path}`, () => {
      expect(strays(read(fixture.native), ['tab'])).toEqual([]);
    });
  }

  it('none in the large score with effects and note marks', () => {
    const built = withNoteMarks(withEffects(largeScore(3, 32, { structure: true })));
    expect(strays(built, ['tab'])).toEqual([]);
  });

  it('none in the long score with effects in both notation', { timeout: 30_000 }, () => {
    const built = withEffects(largeScore(8, 300, { structure: true }));
    expect(strays(built, ['tab'], ['both'], ['paged', 'continuous'])).toEqual([]);
  });
});

describe('stray primitives on the five-line staves', () => {
  // Pins #124: turn into `it` when it starts failing.
  it.fails('draws nothing outside a five-line staff of the corpus (#124)', () => {
    const found = fixtures.flatMap((fixture) =>
      strays(read(fixture.native), ['standard', 'percussion']).map(
        (line) => `${fixture.path}: ${line}`,
      ),
    );
    expect(found).toEqual([]);
  });
});

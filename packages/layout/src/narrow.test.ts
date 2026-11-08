import { parseNative, type Notation, type Score } from '@reprise/model';
import { largeScore, note, score, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, inject, it } from 'vitest';

import {
  DEFAULT_MARGINS,
  PAGE_SIZES,
  layout,
  type LayoutOptions,
  type LayoutResult,
} from './index';
import { expectInsidePages, expectValid } from './test/check-result';
import { withEffects, withNoteMarks } from './test/effects';

// The package compiles against ES2022 alone, which declares no TextEncoder.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

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
const read = (native: string): Score => parseNative(new TextEncoder().encode(native)).score;

const MARGIN = DEFAULT_MARGINS.paged.right;
const CONTENT_WIDTHS = [320, 480, 640];
const ZOOMS = [1, 1.25];
const NOTATIONS: readonly Notation[] = ['tab', 'standard', 'both'];
const EPSILON = 0.02;

/** Every track at `notation`, except pitched tracks, which keep their own. */
function optionsFor(built: Score, notation: Notation, width: number, zoom: number): LayoutOptions {
  return {
    mode: 'paged',
    width,
    zoom,
    tracks: 'all',
    notation: Object.fromEntries(
      built.tracks.map((track) => [
        track.id,
        track.kind === 'pitched' ? track.display.notation : notation,
      ]),
    ),
  };
}

function expectFits(result: LayoutResult, width: number, label: string): void {
  expectValid(result);
  expectInsidePages(result, DEFAULT_MARGINS.paged);
  for (const system of result.systems) {
    expect(system.bbox.x + system.bbox.width, `${label}: ${system.id}`).toBeLessThanOrEqual(
      width - MARGIN + EPSILON,
    );
  }
}

/** Lays `built` out at every narrow width, zoom and notation, and checks each result fits. */
function expectFitsEverywhere(built: Score): void {
  for (const content of CONTENT_WIDTHS) {
    const width = content + 2 * MARGIN;
    for (const zoom of ZOOMS) {
      for (const notation of NOTATIONS) {
        const result = layout(built, optionsFor(built, notation, width, zoom));
        expectFits(result, width, `${String(content)} px, ${String(zoom)}x, ${notation}`);
      }
    }
  }
}

const LONG = 'An unreasonably long marking that runs on and on..';

function sixtyFourths(builder: ScoreBuilder, last: Parameters<ScoreBuilder['beat']>[2] = {}) {
  for (let i = 0; i < 64; i++) {
    builder.beat('64', [note((i % 6) + 1, 12)], i === 63 ? last : {});
  }
  return builder;
}

const SCENES: Record<string, () => Score> = {
  'one bar of 64 64ths': () => sixtyFourths(score().track('guitar').bar()).build(),
  'a squeezed bar with words on its last beat': () =>
    sixtyFourths(score().track('guitar').bar(), {
      chord: { name: 'Cmaj7(add9,#11)/G' },
      text: 'let ring',
      lyrics: ['syllable'],
    }).build(),
  'a half note whose beat text is longer than the line': () =>
    score()
      .track('guitar')
      .bar()
      .beat('2', [note(1, 3)], { text: `${LONG} ${LONG} ${LONG}` })
      .beat('2', [note(2, 3)])
      .build(),
  'a chord name on every 32nd': () => {
    const builder = score().track('guitar').bar();
    for (let i = 0; i < 32; i++) builder.beat('32', [note(1, i % 12)], { chord: { name: 'Am7' } });
    return builder.build();
  },
  'a long tempo label on a 64th bar': () =>
    sixtyFourths(score().track('guitar').bar().tempo(96, { label: LONG })).build(),
  'a long tempo label on a whole-note bar': () =>
    score()
      .track('guitar')
      .bar()
      .tempo(96, { label: LONG })
      .beat('1', [note(1, 0)])
      .build(),
  'a long section name': () =>
    score()
      .track('guitar')
      .bar()
      .section(LONG)
      .beat('1', [note(1, 0)])
      .build(),
  'a long track name': () =>
    score()
      .track('guitar', { name: LONG })
      .bar()
      .beat('1', [note(1, 0)])
      .build(),
  'a bar mid-score that changes to seven sharps with a tempo label': () => {
    const builder = score().track('guitar');
    for (let b = 0; b < 3; b++) {
      builder.bar();
      if (b === 1) builder.key(7).tempo(90, { label: 'Allegro moderato' });
      for (let i = 0; i < 8; i++) builder.beat('8', [note((i % 6) + 1, 5)]);
    }
    return builder.build();
  },
};

describe('narrow pages', () => {
  it('reads the corpus', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(`fit ${fixture.path}`, () => {
      expectFitsEverywhere(read(fixture.native));
    });
  }

  it('fit the large score with effects and note marks', () => {
    expectFitsEverywhere(withNoteMarks(withEffects(largeScore(3, 32, { structure: true }))));
  });

  for (const [name, build] of Object.entries(SCENES)) {
    it(`fit ${name}`, () => {
      expectFitsEverywhere(build());
    });
  }
});

describe('a bar wider than A4 or Letter', () => {
  for (const path of ['gp3/notes.gp3', 'gp4/notes.gp4']) {
    for (const [size, { width }] of Object.entries({
      a4: PAGE_SIZES.a4,
      letter: PAGE_SIZES.letter,
    })) {
      it(`is squeezed to the margin in ${path} on ${size}`, () => {
        const fixture = fixtures.find((candidate) => candidate.path === path);
        if (!fixture) throw new Error(`${path} is not in the corpus`);
        const built = read(fixture.native);
        for (const notation of NOTATIONS) {
          const result = layout(built, optionsFor(built, notation, width, 1));
          expectFits(result, width, notation);
          const ends = result.systems.map((system) => system.bbox.x + system.bbox.width);
          expect(ends.some((end) => Math.abs(end - (width - MARGIN)) <= EPSILON)).toBe(true);
        }
      });
    }
  }
});

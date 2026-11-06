import { cleanup } from '@testing-library/react';
import { layout, type LayoutOptions } from '@reprise/layout';
import { parseNative, type Score } from '@reprise/model';
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import { uniformNotation, viewLayoutOptions, type NotationChoice } from '@/features/score';

import { expectScoreFonts, paintPage, type Theme } from './test/paint-page';
import { DEFAULT_THEME, SCENES, type Scene } from './test/scenes';

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

function scoreOf(scene: Scene): Score {
  if ('build' in scene.source) return scene.source.build();
  const { fixture } = scene.source;
  const found = fixtures.find(({ path }) => path === fixture);
  if (!found) throw new Error(`the corpus has no fixture ${fixture}`);
  return parseNative(new TextEncoder().encode(found.native)).score;
}

function optionsOf(scene: Scene, built: Score, notation: NotationChoice): LayoutOptions {
  const options = viewLayoutOptions(
    { mode: scene.mode ?? 'paged', paper: 'a4' },
    { tracks: 'all', notation: uniformNotation(built, notation) },
  );
  return scene.width !== undefined && options.mode === 'paged'
    ? { ...options, width: scene.width }
    : options;
}

interface Capture {
  name: string;
  notation: NotationChoice;
  page: number;
  theme: Theme;
}

function capturesOf(scene: Scene): Capture[] {
  const pages = scene.pages ?? [0];
  return scene.notations.flatMap((notation) => {
    const themes: Theme[] = [
      DEFAULT_THEME,
      ...(scene.light?.includes(notation) ? ['light' as const] : []),
    ];
    return pages.flatMap((page) =>
      themes.map((theme) => ({
        name: [scene.id, notation, ...(scene.pages ? [`p${String(page)}`] : []), theme].join('-'),
        notation,
        page,
        theme,
      })),
    );
  });
}

beforeAll(expectScoreFonts);
afterEach(cleanup);

for (const scene of SCENES) {
  describe(scene.id, () => {
    let built: Score | undefined;
    const scoreFor = () => (built ??= scoreOf(scene));

    for (const capture of capturesOf(scene)) {
      it(`${capture.name}: ${scene.covers}`, async () => {
        const source = scoreFor();
        const result = layout(source, optionsOf(scene, source, capture.notation));
        scene.guard?.(result);
        const locator = paintPage(result, capture.page, capture.theme);
        await expect.element(locator).toMatchScreenshot(capture.name);
      });
    }
  });
}

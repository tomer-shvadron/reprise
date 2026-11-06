import { cleanup } from '@testing-library/react';
import { layout, type LayoutOptions } from '@reprise/layout';
import { parseNative, type Score } from '@reprise/model';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { commands } from 'vitest/browser';

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
    checkOrphanBaselines: boolean;
  }
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** The file names in the committed baselines' directory. */
    baselineFiles: () => Promise<string[]>;
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

function capturesOf(scene: Scene, pageCount: (notation: NotationChoice) => number): Capture[] {
  return scene.notations.flatMap((notation) => {
    const pages =
      scene.pages === 'all'
        ? Array.from({ length: pageCount(notation) }, (_, page) => page)
        : (scene.pages ?? [0]);
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

const captureNames = new Set<string>();

beforeAll(expectScoreFonts);
afterEach(cleanup);
afterAll(async () => {
  if (!inject('checkOrphanBaselines')) return;
  const orphans = (await commands.baselineFiles()).filter(
    (file) => !captureNames.has(file.replace(/-chromium-linux\.png$/, '')),
  );
  expect(orphans, 'baselines that no scene captures any more; git rm them').toEqual([]);
});

for (const scene of SCENES) {
  describe(scene.id, () => {
    let built: Score | undefined;
    const scoreFor = () => (built ??= scoreOf(scene));

    const layoutFor = (notation: NotationChoice) => {
      const source = scoreFor();
      return layout(source, optionsOf(scene, source, notation));
    };
    const pageCount = (notation: NotationChoice) => layoutFor(notation).pages.length;

    for (const capture of capturesOf(scene, pageCount)) {
      captureNames.add(capture.name);
      it(`${capture.name}: ${scene.covers}`, async () => {
        const result = layoutFor(capture.notation);
        if (scene.pages === undefined) {
          // Otherwise a scene that grows a page is cropped to page 0 without a word.
          expect(result.pages, 'a scene without pages must fit on one page').toHaveLength(1);
        }
        scene.guard?.(result);
        const locator = paintPage(result, capture.page, capture.theme);
        await expect.element(locator).toMatchScreenshot(capture.name);
      });
    }
  });
}

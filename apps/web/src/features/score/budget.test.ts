import { LayoutCache, layout, type LayoutResult } from '@reprise/layout';
import { applyCommand, setBeatDuration } from '@reprise/model';
import { beatOf } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { ZOOM } from '@/state/ui';

import { longLayout, sharedLongScore } from './test/long-score';
import {
  uniformNotation,
  viewLayoutOptions,
  type NotationChoice,
  type ViewSettings,
} from './view-options';
import {
  canvasOffset,
  layoutExtent,
  mountedElementCount,
  mountedPages,
  mountedSystems,
  visibleWindow,
  type Point,
} from './viewport';

/** The roadmap's "Mounted SVG elements at any zoom". */
const BUDGET = 20_000;
const viewport = { width: 1920, height: 1080 };

function countAt(layout: LayoutResult, zoom: number, position: number): number {
  const extent = layoutExtent(layout);
  const offset = canvasOffset(viewport, extent, zoom);
  const centre: Point = { x: extent.width * position, y: extent.height * position };
  const window = visibleWindow(centre, viewport, zoom, offset);
  const range = mountedSystems(layout.systems, window);
  return mountedElementCount(
    layout,
    range,
    mountedPages(layout.pages, layout.systems, range, window),
  );
}

describe('mounted element budget on the long score', () => {
  const views: ViewSettings[] = [
    { mode: 'paged', paper: 'a4' },
    { mode: 'continuous', paper: 'a4' },
  ];
  const notations: NotationChoice[] = ['default', 'both'];

  for (const view of views) {
    for (const notation of notations) {
      it(
        `stays under ${String(BUDGET)} in ${view.mode} ${notation}`,
        { timeout: 30_000 },
        async ({ annotate }) => {
          const layout = longLayout(view, notation);
          let worst = 0;
          for (const zoom of [ZOOM.min, 1, 2, ZOOM.max]) {
            for (const position of [0, 0.5, 1]) {
              const count = countAt(layout, zoom, position);
              worst = Math.max(worst, count);
              expect(count).toBeLessThan(BUDGET);
            }
          }
          await annotate(`${view.mode} ${notation}: at most ${String(worst)} elements`);
        },
      );
    }
  }
});

/**
 * Continuous segments are stable across edits (#147): a kept one may run up to 1.5 lines, so after
 * many edits the worst window mounts more than a fresh layout's, which this bounds.
 */
describe('mounted element budget after many widening edits', () => {
  const view: ViewSettings = { mode: 'continuous', paper: 'a4' };
  for (const notation of ['default', 'both'] as const) {
    it(
      `stays under ${String(BUDGET)} in continuous ${notation}`,
      { timeout: 120_000 },
      async ({ annotate }) => {
        let score = sharedLongScore();
        const options = viewLayoutOptions(view, {
          tracks: 'all',
          notation: uniformNotation(score, notation),
        });
        const cache = new LayoutCache();
        let edited = layout(score, options, cache);
        // A different bar each time: its first beat halved to a sixteenth makes the bar wider.
        for (let edit = 0; edit < 300; edit++) {
          const beat = beatOf(score, edit % 8, edit, 0);
          const applied = applyCommand(
            score,
            setBeatDuration({ beatId: beat.id }, { duration: 16 }),
          );
          score = applied.score;
          edited = layout(score, { ...options, dirtyBars: applied.change.touchedBars }, cache);
        }
        let worst = 0;
        for (const zoom of [ZOOM.min, 1, 2, ZOOM.max]) {
          for (const position of [0, 0.25, 0.5, 0.75, 1]) {
            const count = countAt(edited, zoom, position);
            worst = Math.max(worst, count);
            expect(count).toBeLessThan(BUDGET);
          }
        }
        await annotate(`continuous ${notation}, 300 edits: at most ${String(worst)} elements`);
      },
    );
  }
});

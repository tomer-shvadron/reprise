import type { LayoutResult } from '@reprise/layout';
import { describe, expect, it } from 'vitest';

import { ZOOM } from '@/state/ui';

import { pageFlow } from './page-flow';
import { longLayout } from './test/long-score';
import type { NotationChoice, ViewSettings } from './view-options';
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
  const flow = pageFlow(layout);
  const extent = layoutExtent(flow);
  const offset = canvasOffset(viewport, extent, zoom);
  const centre: Point = { x: extent.width * position, y: extent.height * position };
  const window = visibleWindow(centre, viewport, zoom, offset);
  const range = mountedSystems(flow.systems, window);
  return mountedElementCount(layout, range, mountedPages(flow.pages, flow.systems, range, window));
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

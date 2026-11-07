import { cleanup, render, screen } from '@testing-library/react';
import { LayoutCache, layout, type LayoutResult } from '@reprise/layout';
import { applyCommand, setNote } from '@reprise/model';
import { beatOf } from '@reprise/model/testing';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { median } from './demo/perf-stats';
import { ScoreView } from './score-view';
import { longScore } from './test/long-score';
import { stubViewport } from './test/viewport-stub';
import { viewLayoutOptions } from './view-options';

const RUNS = 5;
const options = viewLayoutOptions({ mode: 'paged', paper: 'a4' }, { tracks: 'all', notation: {} });

function profiled(result: LayoutResult, onRender: ProfilerOnRenderCallback) {
  return (
    <Profiler id="score" onRender={onRender}>
      <ScoreView layout={result} zoom={1} />
    </Profiler>
  );
}

beforeEach(() => {
  stubViewport(1920, 1080);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom's DOM costs are not a browser's, so these are measured and annotated, not asserted;
// the browser numbers come from the /dev/score demo (README, "Performance").
describe('painter performance in jsdom', () => {
  it(
    'mounts the long score and repaints one edited system',
    { timeout: 60_000 },
    async ({ annotate }) => {
      const mounts: number[] = [];
      const repaints: number[] = [];
      let score = longScore();
      const cache = new LayoutCache();
      let result = layout(score, options, cache);

      for (let run = 0; run < RUNS; run++) {
        let mount = 0;
        render(
          profiled(result, (_, phase, actual) => {
            if (phase === 'mount') mount += actual;
          }),
        );
        mounts.push(mount);
        cleanup();
      }

      let repaint = 0;
      const { rerender } = render(
        profiled(result, (_, phase, actual) => {
          if (phase !== 'mount') repaint += actual;
        }),
      );
      const region = screen.getByRole('region', { name: 'Score' });
      // The first system's first part, which holds track 0: the long score's systems split, so
      // the second system starts on page 2, out of the mounted range.
      const edited = result.systems[0];
      if (!edited) throw new Error('no system');
      for (let run = 0; run < RUNS; run++) {
        const { score: next, change } = applyCommand(
          score,
          setNote(
            { beatId: beatOf(score, 0, edited.bars.start, 0).id },
            { string: 1, fret: run + 1 },
          ),
        );
        score = next;
        result = layout(score, { ...options, dirtyBars: change.touchedBars }, cache);
        const records: MutationRecord[] = [];
        const observer = new MutationObserver((batch) => records.push(...batch));
        observer.observe(region, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        repaint = 0;
        rerender(
          profiled(result, (_, phase, actual) => {
            if (phase !== 'mount') repaint += actual;
          }),
        );
        records.push(...observer.takeRecords());
        observer.disconnect();
        repaints.push(repaint);
        const systems = new Set(
          records.map(({ target }) =>
            (target instanceof Element ? target : target.parentElement)
              ?.closest('svg[data-system-id]')
              ?.getAttribute('data-system-id'),
          ),
        );
        expect([...systems]).toEqual([edited.id]);
      }

      await annotate(
        `jsdom: mount median ${median(mounts).toFixed(1)} ms of ${mounts.map((m) => m.toFixed(1)).join(', ')}; ` +
          `repaint after one edit median ${median(repaints).toFixed(1)} ms of ${repaints.map((m) => m.toFixed(1)).join(', ')}`,
      );
    },
  );
});

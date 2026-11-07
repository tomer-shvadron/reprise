import { cleanup, render } from '@testing-library/react';
import { parseNative, type Score } from '@reprise/model';
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { commands } from 'vitest/browser';

import {
  layoutForPrint,
  PrintDocument,
  uniformNotation,
  type NotationChoice,
  type PaperSize,
  type PrintContent,
} from '@/features/score';
import { demoFileName, LONG_FIXTURE } from '@/features/score/demo/demo-params';
import { longScore } from '@/features/score/test/long-score';

import { expectScoreFonts } from './test/paint-page';
import type { PrintedPdf } from './test/printed-pdf';

import '@/index.css';

declare module 'vitest' {
  export interface ProvidedContext {
    demoUrl: string;
  }
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** Prints the demo's print view at `url` to `.vitest/print/<name>.pdf` and measures it. */
    printPdf: (url: string, name: string) => Promise<PrintedPdf>;
  }
}

/** CSS px to PDF points. */
const POINTS = 0.75;
const PAPER_PX = { a4: [794, 1123], letter: [816, 1056] } as const;

function scoreOf(fixture: string): Score {
  if (fixture === LONG_FIXTURE) return longScore();
  const found = inject('scoreFixtures').find(({ path }) => path === fixture);
  if (!found) throw new Error(`the corpus has no fixture ${fixture}`);
  return parseNative(new TextEncoder().encode(found.native)).score;
}

/** What the demo's print view lays out: every track, the header and page numbers. */
function contentOf(fixture: string, paper: PaperSize, notation: NotationChoice): PrintContent {
  const built = scoreOf(fixture);
  return layoutForPrint(
    built,
    {
      tracks: built.tracks.map(({ id }) => id),
      paper,
      header: true,
      pageNumbers: true,
    },
    uniformNotation(built, notation),
    demoFileName(fixture),
  );
}

const FIXTURES: [string, NotationChoice][] = [
  ['gp5/effects.gp5', 'both'],
  ['gp5/key-signatures.gp5', 'standard'],
  ['gp/drum-tabs.gp', 'default'],
];

const CASES: [string, NotationChoice, PaperSize][] = [
  ...FIXTURES.flatMap(([fixture, notation]) =>
    (['a4', 'letter'] as const).map((paper): [string, NotationChoice, PaperSize] => [
      fixture,
      notation,
      paper,
    ]),
  ),
  [LONG_FIXTURE, 'default', 'a4'],
];

beforeAll(expectScoreFonts);
afterEach(cleanup);

describe('print to PDF', () => {
  it.each(CASES)(
    '%s in %s on %s prints one sheet per page, each the paper, no system across a sheet edge',
    async (fixture, notation, paper) => {
      const expected = contentOf(fixture, paper, notation).result.pages.length;
      const query = new URLSearchParams({ fixture, notation, paper, view: 'print', theme: 'dark' });
      const stem = fixture === LONG_FIXTURE ? 'long' : (fixture.split('/').pop() ?? fixture);
      const name = `${stem.replace(/\.\w+$/, '')}-${notation}-${paper}`;
      const printed = await commands.printPdf(`${inject('demoUrl')}?${query.toString()}`, name);

      expect(printed.domPages).toBe(expected);
      expect(printed.pdfPages, 'an extra sheet is a spill, a missing one a lost page').toBe(
        expected,
      );
      const [width, height] = PAPER_PX[paper];
      for (const [w, h] of printed.mediaBoxes) {
        expect(w).toBeCloseTo(width * POINTS, 0);
        expect(h).toBeCloseTo(height * POINTS, 0);
        expect(Math.abs(w - width * POINTS)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(h - height * POINTS)).toBeLessThanOrEqual(0.5);
      }
      for (const [i, page] of printed.geometry.entries()) {
        expect(Math.abs(page.top - i * height), `page ${String(i)} top`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(page.width - width)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(page.height - height)).toBeLessThanOrEqual(0.5);
        expect(page.systemsInside, `a system crosses sheet ${String(i)}`).toBe(true);
      }
      const { readyMs, pdfMs, pdfBytes, nodes, jsHeapBytes } = printed;
      console.info(
        JSON.stringify({ name, pages: expected, readyMs, pdfMs, pdfBytes, nodes, jsHeapBytes }),
      );
    },
    120_000,
  );
});

describe('the print document', () => {
  it.each(['a4', 'letter'] as const)(
    'paints the light paper with its header and page number under the dark theme on %s',
    async (paper) => {
      document.body.style.margin = '0';
      document.documentElement.dataset['theme'] = 'dark';
      const { container } = render(
        <div className="bg-background">
          <PrintDocument preview content={contentOf('gp5/effects.gp5', paper, 'both')} />
        </div>,
      );
      const page = container.querySelector<HTMLElement>('[data-page="0"]');
      if (!page) throw new Error('no first page');
      await expect.element(page).toMatchScreenshot(`print-effects-both-${paper}-p0-dark`);
    },
  );
});

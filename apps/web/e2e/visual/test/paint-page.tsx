import type { LayoutResult } from '@reprise/layout';
import { render } from '@testing-library/react';
import { expect } from 'vitest';
import { page as browser, type Locator } from 'vitest/browser';

import { ScorePage, loadScoreFonts } from '@/features/score';

import '@/index.css';

export type Theme = 'dark' | 'light';

const FAMILIES = ['Bravura', 'Geist Variable'];

/** Room below the last system, so the crop holds what hangs under it (lyrics, dynamics). */
const BOTTOM_ROOM = 24;

/**
 * Loads the score fonts and fails unless every Bravura and Geist face is loaded:
 * `loadScoreFonts` falls back quietly, which is right for the app and wrong for a baseline.
 * `document.fonts.check()` is not enough, since it is true when no face matches.
 */
export async function expectScoreFonts(): Promise<void> {
  await loadScoreFonts();
  const faces = [...document.fonts].filter((face) =>
    FAMILIES.includes(face.family.replaceAll('"', '')),
  );
  expect(new Set(faces.map((face) => face.family.replaceAll('"', '')))).toEqual(new Set(FAMILIES));
  expect(
    faces
      .filter((face) => face.status !== 'loaded')
      .map((face) => `${face.family} ${face.unicodeRange}: ${face.status}`),
  ).toEqual([]);
}

/** Paints one page of `result` at zoom 1, cropped to its systems, and returns its locator. */
export function paintPage(result: LayoutResult, pageIndex: number, theme: Theme): Locator {
  const page = result.pages[pageIndex];
  if (!page) throw new Error(`the layout has no page ${String(pageIndex)}`);
  const systems = result.systems.slice(page.systems.start, page.systems.end);
  const bottom = Math.max(...systems.map(({ bbox }) => bbox.y + bbox.height));
  const height = Math.ceil(bottom - page.bbox.y + BOTTOM_ROOM);

  document.body.style.margin = '0';
  document.documentElement.dataset['theme'] = theme;
  // The app's shell sits behind the paper, so a transparent paper shows as a whole-page diff.
  const { container } = render(
    <div className="bg-background">
      <ScorePage
        page={page}
        systems={systems}
        primitives={result.primitives}
        zoom={1}
        height={height}
        // A fractional width rounds up in the capture, whose last column is then the shell.
        style={{ width: Math.floor(page.bbox.width) }}
      />
    </div>,
  );
  const element = container.querySelector<HTMLElement>('[data-page]');
  if (!element) throw new Error('ScorePage rendered no page element');
  const box = element.getBoundingClientRect();
  expect(
    { right: box.right, bottom: box.bottom },
    'the page must fit the viewport, or the capture is clipped',
  ).toEqual({
    right: Math.min(box.right, window.innerWidth),
    bottom: Math.min(box.bottom, window.innerHeight),
  });
  return browser.elementLocator(element);
}

import { DEFAULT_MARGINS, PAGE_SIZES, type LayoutResult, type Rect } from '@reprise/layout';
import { createScoreMeta, type Score } from '@reprise/model';
import { fullScore, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  layoutForPrint,
  printHeading,
  printLayoutOptions,
  type PrintHeading,
  type PrintSettings,
} from './print-layout';
import { longScore } from './test/long-score';
import { uniformNotation, type NotationChoice } from './view-options';

const margins = DEFAULT_MARGINS.paged;
const EPSILON = 0.01;

const inside = (rect: Rect, box: Rect) =>
  rect.x >= box.x - EPSILON &&
  rect.y >= box.y - EPSILON &&
  rect.x + rect.width <= box.x + box.width + EPSILON &&
  rect.y + rect.height <= box.y + box.height + EPSILON;

/** Every primitive and anchor inside its page, every system inside the margins and under the header. */
function expectInsidePrintedPages(result: LayoutResult, heading: PrintHeading | undefined): void {
  const header = heading?.height ?? 0;
  for (const system of result.systems) {
    const page = result.pages[system.page];
    if (!page) throw new Error(`${system.id} has no page`);
    const { bbox } = page;
    const top = bbox.y + margins.top + (page.index === 0 ? header : 0);
    const bottom = bbox.y + bbox.height - margins.bottom;
    expect(system.bbox.y, `${system.id} above its page's room`).toBeGreaterThanOrEqual(
      top - EPSILON,
    );
    expect(system.bbox.y + system.bbox.height, `${system.id} below the margin`).toBeLessThanOrEqual(
      bottom + EPSILON,
    );
    const headerBox = { x: 0, y: bbox.y, width: bbox.width, height: margins.top + header };
    for (const primitive of result.primitives.slice(
      system.primitives.start,
      system.primitives.end,
    )) {
      if (!inside(primitive.bbox, bbox)) {
        expect.fail(`${primitive.kind} of ${system.id} outside page ${String(page.index)}`);
      }
      if (page.index === 0 && primitive.bbox.y < headerBox.y + headerBox.height - EPSILON) {
        expect.fail(`${primitive.kind} of ${system.id} meets the header`);
      }
    }
    for (const anchor of result.anchors.slice(system.anchors.start, system.anchors.end)) {
      if (!inside(anchor.bbox, bbox)) {
        expect.fail(`${anchor.kind} ${anchor.id} outside page ${String(page.index)}`);
      }
    }
  }
}

function titled(built: Score): Score {
  return { ...built, meta: createScoreMeta({ title: 'Print test', artist: 'Reprise' }) };
}

const cases: [string, () => Score, NotationChoice][] = [
  ['two tracks in tab', () => titled(largeScore(2, 40)), 'tab'],
  ['eight tracks in both, split', () => titled(largeScore(8, 6)), 'both'],
  ['the full score', () => titled(fullScore()), 'default'],
];

describe('layoutForPrint', () => {
  describe.each(['a4', 'letter'] as const)('on %s', (paper) => {
    it.each(cases)('keeps every primitive of %s inside its printed page', (_, make, notation) => {
      const built = make();
      const settings: PrintSettings = {
        tracks: built.tracks.map(({ id }) => id),
        paper,
        header: true,
        pageNumbers: true,
      };
      const content = layoutForPrint(built, settings, uniformNotation(built, notation), 'x.gp');
      expect(content.heading?.height).toBe(68);
      expect(content.result.pages[0]?.bbox.width).toBe(PAGE_SIZES[paper].width);
      expect(content.result.pages[0]?.bbox.height).toBe(PAGE_SIZES[paper].height);
      expectInsidePrintedPages(content.result, content.heading);
    });

    it('keeps every primitive of the long score inside its printed page', () => {
      const built = titled(longScore());
      const settings: PrintSettings = {
        tracks: built.tracks.map(({ id }) => id),
        paper,
        header: true,
        pageNumbers: true,
      };
      const content = layoutForPrint(built, settings, {}, 'long.reprise');
      expect(content.result.systems.at(-1)?.bars.end).toBe(300);
      expectInsidePrintedPages(content.result, content.heading);
    }, 30_000);
  });

  it('prints only the chosen tracks the score still has, with no heading when it is off', () => {
    const built = largeScore(3, 4);
    const [first, , third] = built.tracks.map(({ id }) => id);
    if (first === undefined || third === undefined) throw new Error('no tracks');
    const content = layoutForPrint(
      built,
      { tracks: [first, 'gone', third], paper: 'a4', header: false, pageNumbers: false },
      {},
      'x.gp',
    );
    expect(content.settings.tracks).toEqual([first, third]);
    expect(content.heading).toBeUndefined();
    expect(new Set(content.result.systems[0]?.staves.map(({ track }) => track))).toEqual(
      new Set([first, third]),
    );
    expect(content.result.systems[0]?.bbox.y).toBe(margins.top);
  });
});

describe('printHeading', () => {
  const meta = (title = '', artist = '', album = '') => ({ title, artist, album });

  it('takes the title and byline from the score, and the title from the file name otherwise', () => {
    expect(printHeading(meta('Song', 'Band', 'Record'), 'file.gp')).toEqual({
      title: 'Song',
      byline: 'Band — Record',
      height: 68,
    });
    expect(printHeading(meta(), 'my.song.gp5')).toEqual({ title: 'my.song', height: 48 });
  });

  it('makes a byline from the artist or the album alone', () => {
    expect(printHeading(meta('', 'Band'), undefined)).toEqual({ byline: 'Band', height: 38 });
    expect(printHeading(meta('Song', '', 'Record'), undefined)?.byline).toBe('Record');
  });

  it('is undefined with neither line', () => {
    expect(printHeading(meta(), undefined)).toBeUndefined();
    expect(printHeading(meta(' '), '')).toBeUndefined();
  });
});

describe('printLayoutOptions', () => {
  it('lays out paged at zoom 1 at the paper size, with the tracks, notation and header', () => {
    const settings: PrintSettings = {
      tracks: ['a', 'b'],
      paper: 'letter',
      header: true,
      pageNumbers: true,
    };
    expect(printLayoutOptions(settings, { a: 'both' }, 68)).toEqual({
      mode: 'paged',
      zoom: 1,
      width: PAGE_SIZES.letter.width,
      pageHeight: PAGE_SIZES.letter.height,
      tracks: ['a', 'b'],
      notation: { a: 'both' },
      headerHeight: 68,
    });
    expect(printLayoutOptions(settings, {}, 0)).not.toHaveProperty('headerHeight');
  });
});

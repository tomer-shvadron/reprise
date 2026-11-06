import { render } from '@testing-library/react';
import { layout, PAGE_SIZES } from '@reprise/layout';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { ScorePage, ScorePages } from './score-page';

const result = layout(largeScore(2, 60), {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
});

describe('ScorePages', () => {
  it('draws every page and every system with no virtualization', () => {
    expect(result.pages.length).toBeGreaterThan(1);
    const { container } = render(<ScorePages layout={result} zoom={0.5} />);
    const pages = container.querySelectorAll<HTMLElement>('.score-pages > [data-page]');
    expect(pages).toHaveLength(result.pages.length);
    expect(container.querySelectorAll('svg[data-system-id]')).toHaveLength(result.systems.length);
    expect(pages[0]?.style.width).toBe(`${String(PAGE_SIZES.a4.width * 0.5)}px`);
    for (const system of result.systems) {
      const page = result.pages[system.page];
      const svg = container.querySelector<SVGSVGElement>(`svg[data-system-id="${system.id}"]`);
      expect(svg?.closest('[data-page]')).toBe(pages[system.page]);
      expect(svg?.style.top).toBe(`${String((system.bbox.y - (page?.bbox.y ?? 0)) * 0.5)}px`);
    }
  });
});

describe('ScorePage', () => {
  it('draws its children inside the page box', () => {
    const page = result.pages[0];
    if (!page) throw new Error('no page');
    const { getByText } = render(
      <ScorePage page={page} systems={[]} primitives={result.primitives} zoom={1}>
        <span>Page 1</span>
      </ScorePage>,
    );
    expect(getByText('Page 1').parentElement).toHaveAttribute('data-page', '0');
  });
});

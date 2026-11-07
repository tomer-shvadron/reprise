import { render } from '@testing-library/react';
import { DEFAULT_MARGINS } from '@reprise/layout';
import { createScoreMeta } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { PrintDocument } from './print-document';
import { layoutForPrint, type PrintSettings } from './print-layout';

const built = { ...largeScore(2, 60), meta: createScoreMeta({ title: 'Song', artist: 'Band' }) };
const settings: PrintSettings = {
  tracks: built.tracks.map(({ id }) => id),
  paper: 'letter',
  header: true,
  pageNumbers: true,
};
const content = layoutForPrint(built, settings, {}, 'song.gp');
const margins = DEFAULT_MARGINS.paged;

describe('PrintDocument', () => {
  it('draws every page and system in page order, hidden from assistive technology', () => {
    const { container } = render(<PrintDocument content={content} />);
    const root = container.querySelector<HTMLElement>('.score-print');
    expect(root?.dataset['paper']).toBe('letter');
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.hasAttribute('data-preview')).toBe(false);
    const pages = [...container.querySelectorAll<HTMLElement>('.score-print > .score-page')];
    expect(pages.length).toBeGreaterThan(2);
    expect(pages).toHaveLength(content.result.pages.length);
    expect(pages.map((page) => page.dataset['page'])).toEqual(
      content.result.pages.map(({ index }) => String(index)),
    );
    expect(container.querySelectorAll('svg[data-system-id]')).toHaveLength(
      content.result.systems.length,
    );
    for (const system of content.result.systems) {
      const svg = container.querySelector(`svg[data-system-id="${system.id}"]`);
      expect(svg?.closest('.score-page')).toBe(pages[system.page]);
    }
  });

  it('marks a preview and leaves it to assistive technology', () => {
    const { container } = render(<PrintDocument content={content} preview />);
    const root = container.querySelector('.score-print');
    expect(root?.hasAttribute('data-preview')).toBe(true);
    expect(root?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('draws the header on the first page only, at the margins and as tall as its room', () => {
    const { container } = render(<PrintDocument content={content} />);
    const headers = container.querySelectorAll<HTMLElement>('.score-print-header');
    expect(headers).toHaveLength(1);
    const header = headers[0];
    expect(header?.closest('.score-page')?.getAttribute('data-page')).toBe('0');
    expect(header?.style.left).toBe(`${String(margins.left)}px`);
    expect(header?.style.top).toBe(`${String(margins.top)}px`);
    expect(header?.style.width).toBe(`${String(816 - margins.left - margins.right)}px`);
    expect(header?.style.height).toBe('68px');
    const title = header?.querySelector('.score-print-title');
    const byline = header?.querySelector('.score-print-byline');
    expect(title?.textContent).toBe('Song');
    expect(byline?.textContent).toBe('Band');
    expect(title?.getAttribute('dir')).toBe('auto');
    expect(byline?.getAttribute('dir')).toBe('auto');
  });

  it('draws no header without a heading, and no page numbers when they are off', () => {
    const plain = layoutForPrint(
      built,
      { ...settings, header: false, pageNumbers: false },
      {},
      'song.gp',
    );
    const { container } = render(<PrintDocument content={plain} />);
    expect(container.querySelector('.score-print-header')).toBeNull();
    expect(container.querySelector('.score-print-page-number')).toBeNull();
  });

  it('numbers every page out of the total', () => {
    const { container } = render(<PrintDocument content={content} />);
    const total = content.result.pages.length;
    const numbers = [...container.querySelectorAll('.score-print-page-number')].map(
      (span) => span.textContent,
    );
    expect(numbers).toEqual(
      Array.from({ length: total }, (_, i) => `${String(i + 1)} / ${String(total)}`),
    );
  });

  it('signals ready once, with its pages in the DOM', () => {
    let pagesAtReady = -1;
    const onReady = vi.fn(() => {
      pagesAtReady = document.querySelectorAll('.score-print > .score-page').length;
    });
    const { rerender } = render(<PrintDocument content={content} onReady={onReady} />);
    rerender(<PrintDocument content={content} onReady={onReady} />);
    expect(onReady).toHaveBeenCalledOnce();
    expect(pagesAtReady).toBe(content.result.pages.length);
  });
});

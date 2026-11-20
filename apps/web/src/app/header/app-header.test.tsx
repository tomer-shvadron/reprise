import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppHeader } from './app-header';
import { renderHeader } from './test/render-header';

describe('AppHeader', () => {
  it('is the banner, holding the crumb, the mode switch, View and Search in order', () => {
    renderHeader(<AppHeader />);
    const banner = screen.getByRole('banner');
    const names = within(banner)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual(['Library', 'View options', 'Search commands']);
    const order = [
      within(banner).getByRole('navigation', { name: 'Breadcrumb' }),
      within(banner).getByRole('radiogroup', { name: 'Mode' }),
      within(banner).getByRole('button', { name: 'View options' }),
      within(banner).getByRole('button', { name: 'Search commands' }),
    ];
    for (let i = 1; i < order.length; i += 1) {
      const previous = order[i - 1];
      const next = order[i];
      expect(
        previous &&
          next &&
          previous.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('is a fixed 28px band that never shrinks', () => {
    renderHeader(<AppHeader />);
    expect(screen.getByRole('banner')).toHaveClass('h-7', 'shrink-0');
  });
});

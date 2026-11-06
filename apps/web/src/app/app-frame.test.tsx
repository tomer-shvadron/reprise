import { render, screen, within } from '@testing-library/react';
import { layout, PAGE_SIZES } from '@reprise/layout';
import { fullScore } from '@reprise/model/testing';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { createUiStore } from '@/state/ui';

import { AppFrame } from './app-frame';

const wrapper = ({ children }: { children: ReactNode }) => (
  <TooltipProvider>{children}</TooltipProvider>
);

describe('AppFrame score region', () => {
  it('shows the placeholder while there is no score', () => {
    render(<AppFrame ui={createUiStore('dark')} placeholder={<p>Open a file</p>} />, {
      wrapper,
    });
    const main = screen.getByRole('main', { name: 'Score' });
    expect(within(main).getByText('Open a file')).toBeInTheDocument();
    expect(within(main).queryByRole('region')).not.toBeInTheDocument();
  });

  it('paints a laid-out score with the score view', () => {
    const result = layout(fullScore(), {
      mode: 'paged',
      width: PAGE_SIZES.a4.width,
      zoom: 1,
      tracks: 'all',
      notation: {},
    });
    render(
      <AppFrame ui={createUiStore('dark')} layout={result} placeholder={<p>Open a file</p>} />,
      { wrapper },
    );
    const main = screen.getByRole('main', { name: 'Score' });
    expect(within(main).getByRole('region', { name: 'Score' })).toHaveAttribute(
      'aria-roledescription',
      'score',
    );
    expect(within(main).queryByText('Open a file')).not.toBeInTheDocument();
  });
});

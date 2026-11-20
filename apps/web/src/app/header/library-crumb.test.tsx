import { score } from '@reprise/model/testing';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LibraryCrumb } from './library-crumb';
import { renderHeader, spyOnCommand } from './test/render-header';

describe('LibraryCrumb', () => {
  it('runs library.show on a click and leaves the screen to that command', async () => {
    const { registry, services } = renderHeader(<LibraryCrumb />);
    const run = spyOnCommand(registry, 'library.show');
    await userEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(run).toHaveBeenCalledOnce();
    expect(services.ui.getState().sheet).toBe('library');
  });

  it('does not take focus on a click', () => {
    renderHeader(<LibraryCrumb />);
    const button = screen.getByRole('button', { name: 'Library' });
    expect(fireEvent.mouseDown(button)).toBe(false);
  });

  it('shows "Library" alone with no song', () => {
    renderHeader(<LibraryCrumb />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(/^Library$/);
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('names the open song as the current page', async () => {
    const { open } = renderHeader(<LibraryCrumb />);
    await open(score().meta({ title: 'Riff' }).track('guitar').build());
    const current = screen.getByText('Riff');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveAttribute('title', 'Riff');
  });

  it('falls back to the file stem for an untitled file', async () => {
    const { open } = renderHeader(<LibraryCrumb />);
    await open(score().track('guitar').build());
    expect(screen.getByText('song')).toHaveAttribute('aria-current', 'page');
  });
});

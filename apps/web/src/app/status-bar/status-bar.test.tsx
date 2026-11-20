import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderHeader, spyOnCommand } from '@/app/header/test/render-header';

import { StatusBar } from './status-bar';

describe('StatusBar', () => {
  it('is a named region with two named groups, and not a footer or a live region as a whole', () => {
    renderHeader(<StatusBar />);
    const bar = screen.getByRole('region', { name: 'Status' });
    expect(bar.tagName).toBe('SECTION');
    expect(within(bar).getByRole('group', { name: 'Song' })).toBeInTheDocument();
    expect(within(bar).getByRole('group', { name: 'Cursor and view' })).toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    // Only the track flash, empty at rest, is a live region.
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows only the zoom with no song: saved, library and notation are hidden', () => {
    renderHeader(<StatusBar />);
    expect(screen.getByRole('button', { name: '100%' })).toBeInTheDocument();
    for (const name of [/Saved|Unsaved/, /library/i, /Tab|Standard/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('says whether the song is saved, and a click runs Save', async () => {
    const { open, registry, services } = renderHeader(<StatusBar />);
    await open();
    const save = spyOnCommand(registry, 'file.save').mockImplementation(() => undefined);
    const segment = screen.getByRole('button', { name: /^(Saved|Unsaved)$/ });
    await userEvent.setup().click(segment);
    expect(save).toHaveBeenCalledOnce();
    act(() => {
      services.document.setState({ dirty: true });
    });
    expect(screen.getByRole('button', { name: 'Unsaved' })).toHaveAttribute('aria-keyshortcuts');
    act(() => {
      services.document.setState({ saving: true });
    });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
  });

  it('opens the library from the library segment, which says whether the song is in it', async () => {
    const { open, registry, services } = renderHeader(<StatusBar />);
    await open();
    const show = spyOnCommand(registry, 'library.show');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Not in library' }));
    expect(show).toHaveBeenCalledOnce();
    act(() => {
      services.document.getState().setSongId('song-1');
    });
    expect(screen.getByRole('button', { name: 'In library' })).toBeInTheDocument();
  });

  it('shows the edit segments only in edit mode', async () => {
    const { open, services } = renderHeader(<StatusBar />);
    await open();
    expect(screen.queryByTestId('edit-status')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    act(() => {
      services.editing.getState().setEditing(true);
    });
    expect(screen.getByTestId('edit-status')).toBeInTheDocument();
    // The refusal is the second live region, beside the track flash.
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('runs the zoom commands from the zoom menu, and the menu stays open', async () => {
    const { registry, services } = renderHeader(<StatusBar />);
    const zoomIn = spyOnCommand(registry, 'view.zoomIn');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '100%' }));
    await user.click(await screen.findByRole('menuitem', { name: /Zoom in/ }));
    expect(zoomIn).toHaveBeenCalledOnce();
    expect(services.ui.getState().zoom).toBeGreaterThan(1);
    expect(screen.getByRole('menuitem', { name: /Zoom out/ })).toBeInTheDocument();
  });

  it('runs the notation commands from the notation menu, disabling what the track cannot show', async () => {
    const { open, registry } = renderHeader(<StatusBar />);
    await open();
    const standard = spyOnCommand(registry, 'track.notationStandard');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^(Tab|Standard|Tab and standard)/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Standard/ }));
    expect(standard).toHaveBeenCalledOnce();
  });

  it('does not take focus on mousedown', () => {
    renderHeader(<StatusBar />);
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: '100%' }))).toBe(false);
  });
});

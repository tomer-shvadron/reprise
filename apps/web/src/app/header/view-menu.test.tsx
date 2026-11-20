import { STANDARD_TUNING } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ZOOM } from '@/state/ui';

import { renderHeader, spyOnCommand } from './test/render-header';
import { ViewMenu } from './view-menu';

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'View options' }));
  await screen.findByRole('menu');
};
const item = (name: string | RegExp) => screen.getByRole('menuitemradio', { name });

describe('ViewMenu', () => {
  it('opens with Enter on the trigger', async () => {
    renderHeader(<ViewMenu />);
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'View options' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('switches layout through view.toggleViewMode and ignores the checked item', async () => {
    const { registry, services } = renderHeader(<ViewMenu />);
    const run = spyOnCommand(registry, 'view.toggleViewMode');
    const user = userEvent.setup();
    await open(user);
    expect(item(/^Page view/)).toBeChecked();
    await user.click(item(/^Page view/));
    expect(run).not.toHaveBeenCalled();
    await open(user);
    await user.click(item(/^Continuous view/));
    expect(run).toHaveBeenCalledOnce();
    expect(services.ui.getState().view.mode).toBe('continuous');
  });

  it('steps the zoom through its commands and stays open', async () => {
    const { registry, services } = renderHeader(<ViewMenu />);
    const zoomIn = spyOnCommand(registry, 'view.zoomIn');
    const zoomOut = spyOnCommand(registry, 'view.zoomOut');
    const reset = spyOnCommand(registry, 'view.zoomReset');
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: /^Zoom in/ }));
    expect(zoomIn).toHaveBeenCalledOnce();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const percent = Math.round(services.ui.getState().zoom * 100);
    expect(percent).toBeGreaterThan(100);
    expect(screen.getByText(`Zoom ${String(percent)}%`)).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /^Zoom out/ }));
    expect(zoomOut).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('menuitem', { name: /^Actual size/ }));
    expect(reset).toHaveBeenCalledOnce();
    expect(services.ui.getState().zoom).toBe(ZOOM.default);
  });

  it('disables Zoom in at the maximum and Zoom out at the minimum', async () => {
    const { services } = renderHeader(<ViewMenu />);
    const user = userEvent.setup();
    act(() => {
      services.ui.getState().setZoom(ZOOM.max);
    });
    await open(user);
    expect(screen.getByRole('menuitem', { name: /^Zoom in/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');
    act(() => {
      services.ui.getState().setZoom(ZOOM.min);
    });
    await open(user);
    expect(screen.getByRole('menuitem', { name: /^Zoom out/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('runs the notation commands for the current track', async () => {
    const { registry, services, open: openSong } = renderHeader(<ViewMenu />);
    await openSong();
    const standard = spyOnCommand(registry, 'track.notationStandard');
    const user = userEvent.setup();
    await open(user);
    expect(screen.getByText('Notation · Lead')).toBeInTheDocument();
    await user.click(item('Standard notation'));
    expect(standard).toHaveBeenCalledOnce();
    const id = services.selection.getState().currentTrack ?? '';
    expect(services.document.getState().view.notation[id]).toBe('standard');
    await open(user);
    expect(item('Standard notation')).toBeChecked();
    expect(item('Tab')).not.toHaveAttribute('aria-disabled');
  });

  it('disables every notation with no score and for a drum track', async () => {
    const { services, open: openSong } = renderHeader(<ViewMenu />);
    const user = userEvent.setup();
    await open(user);
    for (const name of ['Tab', 'Standard notation', 'Tab and standard notation']) {
      expect(item(name)).toHaveAttribute('aria-disabled', 'true');
    }
    await user.keyboard('{Escape}');
    await openSong(score().track('drums', { name: 'Drums' }).build());
    expect(services.selection.getState().currentTrack).toBeDefined();
    await open(user);
    for (const name of ['Tab', 'Standard notation', 'Tab and standard notation']) {
      expect(item(name)).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('offers a track without tab standard notation only, saying why', async () => {
    const { open: openSong } = renderHeader(<ViewMenu />);
    await openSong(
      score()
        .track('piano', {
          name: 'Keys',
          tuning: [...STANDARD_TUNING],
          fretCount: 24,
          display: { notation: 'tab', clef: 'treble', octaveShift: 0 },
        })
        .build(),
    );
    const user = userEvent.setup();
    await open(user);
    expect(item('Tab')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Standard notation')).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('menu')).toHaveAccessibleDescription(
      expect.stringContaining('Tab needs a string and fret'),
    );
  });

  it('returns focus to the trigger after a keyboard open and Escape', async () => {
    renderHeader(<ViewMenu />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'View options' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('returns focus to the element that had it before a pointer open', async () => {
    renderHeader(
      <>
        <button type="button">before</button>
        <ViewMenu />
      </>,
    );
    const user = userEvent.setup();
    const before = screen.getByRole('button', { name: 'before' });
    before.focus();
    await open(user);
    await user.keyboard('{Escape}');
    expect(before).toHaveFocus();
  });
});

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { CommandRegistry } from '@/app/command-registry';
import { renderWithServices } from '@/test/render';
import { fourBars, positionEventAt } from '@/test/position';
import { createTestServices } from '@/test/services';

import { transportCommands } from './commands';
import { renderBar } from './test/render-bar';
import { TransportBar } from './transport-bar';

afterEach(() => {
  vi.useRealTimers();
});

describe('TransportBar', () => {
  it('backs every control with a registered command that has a shortcut and a palette entry', async () => {
    const { container, registry, open } = renderBar();
    await open(fourBars());
    const bar = container.querySelector('[data-transport-controls]');
    const controls = [
      ...(bar?.querySelectorAll('button, input, [role="slider"]') ?? []),
      ...screen.getAllByRole('button', { name: /volume/i }),
    ];
    expect(controls.length).toBeGreaterThanOrEqual(10);
    for (const control of controls) {
      // A value control such as the speed slider is backed by the step commands that move it.
      const ids = (
        control.closest('[data-command]')?.getAttribute('data-command') ??
        control.closest('[data-commands]')?.getAttribute('data-commands') ??
        ''
      )
        .split(' ')
        .filter(Boolean);
      expect(ids, control.outerHTML).not.toEqual([]);
      for (const id of ids) {
        const command = registry.get(id);
        expect(command, control.outerHTML).toBeDefined();
        expect(command?.shortcut, id).toBeDefined();
        expect(command?.inPalette, id).not.toBe(false);
      }
    }
    expect(screen.getByRole('slider', { name: 'Speed' })).toHaveAttribute(
      'aria-keyshortcuts',
      '[ ]',
    );
  });

  it('shows the empty state with no song', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Loop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Count-in' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Metronome' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Master volume' })).toBeEnabled();
    expect(screen.getByRole('group', { name: 'Position' })).toHaveTextContent(
      'Bar –·Beat –·Time at the written tempo 0:00 / 0:00',
    );
  });

  it('runs the commands on click and flips Play to Pause', async () => {
    const { services, open } = renderBar();
    const user = userEvent.setup();
    await open(fourBars());
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(services.fakeAudio.togglePlay).toHaveBeenCalledOnce();
    act(() => {
      services.playback.setState({ transport: 'playing' });
    });
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(services.fakeAudio.stop).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Loop' }));
    expect(screen.getByRole('button', { name: 'Loop bars 1–4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Count-in' }));
    expect(services.fakeAudio.setCountIn).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Count-in' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reads tooltips and aria-keyshortcuts from the registry', async () => {
    const services = createTestServices();
    const registry = new CommandRegistry();
    for (const command of transportCommands(services)) {
      registry.register(
        command.id === 'transport.toggleCountIn'
          ? { ...command, shortcut: { key: 'k', alt: true } }
          : command,
      );
    }
    renderWithServices(<TransportBar registry={registry} keyboard="other" />, services);
    const countIn = screen.getByRole('button', { name: 'Count-in' });
    expect(countIn).toHaveAttribute('aria-keyshortcuts', 'Alt+K');
    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Space',
    );
    await userEvent.setup().hover(countIn);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Count-in (Alt+K)');
  });

  it('moves the readout without re-rendering React', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const services = createTestServices();
    const song = fourBars();
    const { write } = await import('@reprise/formats');
    await services.document
      .getState()
      .openBytes('four.reprise', (await write(song, 'reprise')).bytes);
    const opened = services.document.getState().score ?? song;
    const onRender = vi.fn();
    renderWithServices(
      <Profiler id="bar" onRender={onRender}>
        <TransportBar registry={createAppRegistry(services)} keyboard="mac" />
      </Profiler>,
      services,
    );
    act(() => {
      services.playback.setState({ transport: 'playing' });
    });
    const renders = onRender.mock.calls.length;
    const bar = screen.getByRole('group', { name: 'Position' });
    for (let frame = 1; frame <= 30; frame++) {
      act(() => {
        services.playback.setState({ position: positionEventAt(opened, frame * 240) });
        vi.advanceTimersToNextFrame();
      });
    }
    expect(bar).toHaveTextContent('Bar 2/4');
    expect(onRender).toHaveBeenCalledTimes(renders);
  });
});

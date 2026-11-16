import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppServicesProvider } from '@/app/services-context';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createTestServices } from '@/test/services';

import { MemoryPanel } from './memory-panel';

const MIB = 1024 * 1024;

function setup(memory: Partial<ReturnType<typeof base>> = {}) {
  const services = createTestServices();
  services.playback.setState({ memory: { ...base(), ...memory } });
  const announce = vi.fn();
  render(
    <AppServicesProvider services={services}>
      <TooltipProvider>
        <MemoryPanel onAnnounce={announce} />
      </TooltipProvider>
    </AppServicesProvider>,
  );
  return { services, announce, user: userEvent.setup() };
}

function base() {
  return {
    decodedBytes: 100 * MIB,
    budgetBytes: 300 * MIB,
    residents: ['gm:0:29', 'gm:0:25'],
    unused: [] as string[],
    shortfall: false,
  };
}

describe('MemoryPanel', () => {
  it('shows the meter with a text equivalent, and the residents by name', () => {
    setup();
    const meter = screen.getByRole('meter', { name: 'Sound memory in use' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveAttribute('aria-valuemax', '300');
    expect(meter).toHaveAttribute('aria-valuetext', '100 MB of 300 MB');
    expect(screen.getByText('100 MB of 300 MB')).toBeInTheDocument();
    expect(screen.getByText('2 instruments loaded')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Loaded instruments' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'General MIDI: Acoustic Guitar (steel)',
      'General MIDI: Overdriven Guitar',
    ]);
  });

  it('shows the empty state', () => {
    setup({ residents: [], decodedBytes: 0 });
    expect(screen.getByText('No sounds loaded')).toBeInTheDocument();
  });

  it('collapses a long list behind Show all', async () => {
    const residents = Array.from({ length: 10 }, (_, program) => `gm:0:${String(program)}`);
    const { user } = setup({ residents });
    const list = screen.getByRole('list', { name: 'Loaded instruments' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: 'Show all 10' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
  });

  it('sets the budget in bytes from the select, keeping a stored value that is not a preset', async () => {
    const { services, user } = setup();
    const select = screen.getByRole('combobox', { name: 'Memory for sounds' });
    expect(select).toHaveValue('300');
    await user.selectOptions(select, '64');
    expect(services.fakeAudio.setMemoryBudget).toHaveBeenCalledWith(64 * MIB);
    act(() => {
      services.playback.setState({
        settings: { ...services.playback.getState().settings, memoryBudgetBytes: 80 * MIB },
      });
    });
    expect(screen.getByRole('combobox', { name: 'Memory for sounds' })).toHaveValue('80');
  });

  it('disables Unload unused as "Nothing unused", and enables it with something to free', async () => {
    const { services, announce, user } = setup();
    expect(screen.getByRole('button', { name: 'Nothing unused' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    act(() => {
      services.playback.setState({ memory: { ...base(), unused: ['gm:0:25'] } });
    });
    vi.mocked(services.fakeAudio.unloadUnused).mockReturnValue(1);
    expect(screen.getByText('2 instruments loaded, 1 unused')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unload unused' }));
    expect(services.fakeAudio.unloadUnused).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Freed 1 instrument');
  });

  it('keeps keyboard focus on Unload unused after it frees something', async () => {
    const { services, user } = setup({ unused: ['gm:0:25'] });
    const button = screen.getByRole('button', { name: 'Unload unused' });
    await user.tab();
    await user.tab();
    button.focus();
    await user.keyboard('{Enter}');
    act(() => {
      services.playback.setState({ memory: { ...base(), unused: [] } });
    });
    const after = screen.getByRole('button', { name: 'Nothing unused' });
    expect(after).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(services.fakeAudio.unloadUnused).toHaveBeenCalledTimes(1);
  });

  it('explains a budget below the setting, as on a General MIDI song', () => {
    setup({ budgetBytes: 80 * MIB });
    expect(screen.getByText(/General MIDI songs use at most 80 MB/)).toBeInTheDocument();
  });

  it('keeps the status region mounted around the shortfall note', () => {
    const { services } = setup();
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    act(() => {
      services.playback.setState({ memory: { ...base(), shortfall: true } });
    });
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent(/needs more than the budget/);
  });

  it('shows the shortfall note only while the shortfall lasts', () => {
    const { services } = setup({ shortfall: true });
    expect(screen.getByText(/needs more than the budget/)).toBeInTheDocument();
    act(() => {
      services.playback.setState({ memory: { ...base(), shortfall: false } });
    });
    expect(screen.queryByText(/needs more than the budget/)).toBeNull();
  });
});

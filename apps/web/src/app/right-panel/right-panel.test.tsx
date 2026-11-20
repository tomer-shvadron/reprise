import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';

import { App } from '../app';

function renderApp() {
  const services = createTestServices();
  render(<App services={services} keyboard="mac" />);
  return services;
}

const tab = (name: string) => screen.getByRole('tab', { name });
const rail = () => within(screen.getByRole('group', { name: 'Panel rail' }));

describe('the right panel rail', () => {
  it('stays visible while the panel is collapsed, and each icon opens its view', async () => {
    const { ui } = renderApp();
    expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
    expect(rail().getByRole('button', { name: 'Mixer' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(rail().getByRole('button', { name: 'History' }));
    expect(ui.getState().panels.rightPanel).toBe(true);
    expect(ui.getState().rightPanelView).toBe('history');
    expect(rail().getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');
    expect(tab('History')).toHaveAttribute('aria-selected', 'true');
  });

  it('collapses from the active icon and from the fold button, and expands again', async () => {
    const { ui } = renderApp();
    await userEvent.click(rail().getByRole('button', { name: 'Effects' }));
    await userEvent.click(rail().getByRole('button', { name: 'Effects' }));
    expect(ui.getState().panels.rightPanel).toBe(false);

    await userEvent.click(rail().getByRole('button', { name: 'Right panel', expanded: false }));
    expect(ui.getState().panels.rightPanel).toBe(true);
    expect(ui.getState().rightPanelView).toBe('effects');
    await userEvent.click(rail().getByRole('button', { name: 'Right panel', expanded: true }));
    expect(ui.getState().panels.rightPanel).toBe(false);
  });

  it('keeps F8 toggling the mixer and leaves focus with the page after a click', async () => {
    const { ui } = renderApp();
    await userEvent.keyboard('{F8}');
    expect(ui.getState().panels.rightPanel).toBe(true);
    expect(ui.getState().rightPanelView).toBe('mixer');
    await userEvent.keyboard('{F8}');
    expect(ui.getState().panels.rightPanel).toBe(false);

    await userEvent.click(rail().getByRole('button', { name: 'Mixer' }));
    expect(rail().getByRole('button', { name: 'Mixer' })).not.toHaveFocus();
  });

  it('shows the shortcut in the tooltip where the command has one', async () => {
    renderApp();
    await userEvent.hover(rail().getByRole('button', { name: 'Mixer' }));
    expect((await screen.findAllByText('Mixer (F8)')).length).toBeGreaterThan(0);
  });
});

describe('the right panel tabs', () => {
  it('reads and sets rightPanelView, with Practice holding the three trainer tools', async () => {
    const { ui } = renderApp();
    act(() => {
      ui.getState().showPanelView('mixer');
    });
    expect(screen.getByRole('tablist', { name: 'Panel views' })).toBeInTheDocument();
    expect(tab('Mixer')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tablist', { name: 'Practice tools' })).not.toBeInTheDocument();

    await userEvent.click(tab('Practice'));
    expect(ui.getState().rightPanelView).toBe('speedTrainer');
    await userEvent.click(tab('Tuner'));
    expect(ui.getState().rightPanelView).toBe('tuner');
    expect(tab('Practice')).toHaveAttribute('aria-selected', 'true');

    // Pressing the selected Practice tab keeps the tool the user is on.
    await userEvent.click(tab('Practice'));
    expect(ui.getState().rightPanelView).toBe('tuner');
    expect(screen.getByRole('tabpanel', { name: 'Tuner' })).toBeInTheDocument();
  });

  it('follows the WAI-ARIA keys: roving tab stop, arrows wrap, Home and End', async () => {
    const { ui } = renderApp();
    act(() => {
      ui.getState().showPanelView('mixer');
    });
    expect(tab('Mixer')).toHaveAttribute('tabindex', '0');
    expect(tab('History')).toHaveAttribute('tabindex', '-1');

    act(() => {
      tab('Mixer').focus();
    });
    await userEvent.keyboard('{ArrowLeft}');
    expect(ui.getState().rightPanelView).toBe('history');
    expect(tab('History')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(ui.getState().rightPanelView).toBe('mixer');
    await userEvent.keyboard('{End}');
    expect(ui.getState().rightPanelView).toBe('history');
    await userEvent.keyboard('{Home}');
    expect(ui.getState().rightPanelView).toBe('mixer');
    expect(tab('Mixer')).toHaveFocus();
  });

  it('links each tab to its panel', () => {
    const { ui } = renderApp();
    act(() => {
      ui.getState().showPanelView('effects');
    });
    const panel = screen.getByRole('tabpanel', { name: 'Effects' });
    expect(tab('Effects')).toHaveAttribute('aria-controls', panel.id);
    expect(tab('Mixer')).not.toHaveAttribute('aria-controls');
  });
});

describe('a panel restored at launch', () => {
  it('shows the stored panel without taking focus, and a panel the user opens takes it', async () => {
    const settings = createTestSettings(
      createMemorySettingsBackend([['layout.rightPanelOpen', true]]),
    );
    const services = createTestServices({ settings });
    render(<App services={services} keyboard="mac" />);

    const panel = await screen.findByRole('complementary', { name: 'Panel' });
    expect(within(panel).getByRole('region', { name: 'Mixer' })).toBeInTheDocument();
    expect(panel).not.toContainElement(document.activeElement as HTMLElement | null);

    act(() => {
      services.ui.getState().showPanelView('effects');
    });
    expect(
      within(screen.getByRole('complementary', { name: 'Panel' })).getByRole('region', {
        name: 'Effects',
      }),
    ).toHaveFocus();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { BOTTOM_PANEL_HEIGHT_STORAGE_KEY } from '@/state/bottom-panel-storage';
import { BOTTOM_PANEL_HEIGHT, createUiStore } from '@/state/ui';

import { AppFrame } from './app-frame';

function renderFrame(ui = createUiStore('dark')) {
  render(
    <TooltipProvider>
      <AppFrame ui={ui} score={<p>score</p>} bottom={<p>fret content</p>} />
    </TooltipProvider>,
  );
  return ui;
}

describe('the bottom panel region', () => {
  it('is absent until opened, then a labelled region with the view, and the collapse button closes it', () => {
    const ui = renderFrame();
    expect(screen.queryByRole('region', { name: 'Bottom panel' })).not.toBeInTheDocument();
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    expect(screen.getByRole('region', { name: 'Bottom panel' })).toHaveTextContent('fret content');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse bottom panel' }));
    expect(screen.queryByRole('region', { name: 'Bottom panel' })).not.toBeInTheDocument();
    expect(ui.getState().bottomPanel.open).toBe(false);
  });

  it('resizes by keyboard within bounds, up growing it', () => {
    const ui = renderFrame();
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    const handle = screen.getByRole('separator', { name: 'Resize bottom panel' });
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    expect(handle).toHaveAttribute('aria-valuenow', String(BOTTOM_PANEL_HEIGHT.default));
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(ui.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.default + 16);
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(ui.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.default - 16);
    expect(screen.getByRole('region', { name: 'Bottom panel' })).toHaveStyle({
      height: `${String(BOTTOM_PANEL_HEIGHT.default - 16)}px`,
    });
    for (let i = 0; i < 100; i++) fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(ui.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.max);
    for (let i = 0; i < 100; i++) fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(ui.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.min);
  });
});

describe('the bottom panel state', () => {
  it('remembers the height in a new store', () => {
    createUiStore('dark').getState().setBottomPanelHeight(300);
    expect(window.localStorage.getItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY)).toBe('300');
    expect(createUiStore('dark').getState().bottomPanelHeight).toBe(300);
  });

  it('ignores a stored height out of bounds or not a number', () => {
    window.localStorage.setItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY, '99999');
    expect(createUiStore('dark').getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.default);
    window.localStorage.setItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY, 'tall');
    expect(createUiStore('dark').getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.default);
  });

  it('still works when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      const ui = createUiStore('dark');
      ui.getState().setBottomPanelHeight(250);
      expect(ui.getState().bottomPanelHeight).toBe(250);
    } finally {
      spy.mockRestore();
    }
  });

  it('toggleBottomPanelView opens, then closes, and collapsing keeps the view', () => {
    const ui = createUiStore('dark');
    ui.getState().toggleBottomPanelView('fretboard');
    expect(ui.getState().bottomPanel).toEqual({ open: true, view: 'fretboard' });
    ui.getState().toggleBottomPanelView('fretboard');
    expect(ui.getState().bottomPanel).toEqual({ open: false, view: 'fretboard' });
  });
});

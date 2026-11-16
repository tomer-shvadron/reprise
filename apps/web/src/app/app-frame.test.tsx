import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import {
  BOTTOM_PANEL_HEIGHT_STORAGE_KEY,
  readStoredBottomPanelHeight,
} from '@/state/bottom-panel-storage';
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
    expect(screen.queryByRole('region', { name: 'Fretboard' })).not.toBeInTheDocument();
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    expect(screen.getByRole('region', { name: 'Fretboard' })).toHaveTextContent('fret content');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse bottom panel' }));
    expect(screen.queryByRole('region', { name: 'Fretboard' })).not.toBeInTheDocument();
    expect(ui.getState().bottomPanel.open).toBe(false);
  });

  it('puts the header, the collapse button and a separately scrolling body in the region', () => {
    const ui = renderFrame();
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    const region = screen.getByRole('region', { name: 'Fretboard' });
    expect(region).not.toHaveClass('shrink-0');
    expect(region).toHaveClass('min-h-0');
    expect(screen.getByRole('heading', { name: 'Fretboard' })).toBeInTheDocument();
    expect(screen.getByText('fret content').parentElement).toHaveClass('overflow-auto');
    // Jsdom has no layout; the classes carry the contract: the score row has a floor and the
    // region gives way before the transport does.
    expect(screen.getByRole('main', { name: 'Score' }).parentElement).toHaveClass('min-h-40');
  });

  it('returns focus to where it was before opening, else to the score', () => {
    const ui = renderFrame();
    const toggle = screen.getByRole('button', { name: 'Toggle tracks' });
    toggle.focus();
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    screen.getByRole('button', { name: 'Collapse bottom panel' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse bottom panel' }));
    expect(toggle).toHaveFocus();

    toggle.focus();
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    toggle.remove();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse bottom panel' }));
    expect(screen.getByRole('main', { name: 'Score' })).toHaveFocus();
  });

  it('resizes by a vertical pointer drag, storing the height when it ends', () => {
    const ui = renderFrame();
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const handle = screen.getByRole('separator', { name: 'Resize bottom panel' });
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 450, pointerId: 1 });
    expect(ui.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.default + 50);
    expect(window.localStorage.getItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY)).toBeNull();
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(window.localStorage.getItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY)).toBe(
      String(BOTTOM_PANEL_HEIGHT.default + 50),
    );
    fireEvent.pointerMove(handle, { clientY: 300, pointerId: 1 });
    expect(ui.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.default + 50);
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
    expect(screen.getByRole('region', { name: 'Fretboard' })).toHaveStyle({
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
    const first = createUiStore('dark');
    first.getState().setBottomPanelHeight(300);
    expect(window.localStorage.getItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY)).toBeNull();
    first.getState().persistBottomPanelHeight();
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

  it('falls back to the default when reading storage throws', () => {
    expect(
      readStoredBottomPanelHeight(() => {
        throw new Error('denied');
      }),
    ).toBe(BOTTOM_PANEL_HEIGHT.default);
  });

  it('asks for one follow when the region opens or resizes, only while following', () => {
    const ui = createUiStore('dark');
    const before = ui.getState().follow.request;
    ui.getState().showBottomPanelView('fretboard');
    ui.getState().setBottomPanelHeight(300);
    expect(ui.getState().follow.request).toBe(before + 2);
    ui.getState().pauseFollow();
    ui.getState().setBottomPanelHeight(320);
    ui.getState().setBottomPanelOpen(false);
    expect(ui.getState().follow).toEqual({ on: false, request: before + 2 });
  });

  it('toggleBottomPanelView opens, then closes, and collapsing keeps the view', () => {
    const ui = createUiStore('dark');
    ui.getState().toggleBottomPanelView('fretboard');
    expect(ui.getState().bottomPanel).toEqual({ open: true, view: 'fretboard' });
    ui.getState().toggleBottomPanelView('fretboard');
    expect(ui.getState().bottomPanel).toEqual({ open: false, view: 'fretboard' });
  });
});

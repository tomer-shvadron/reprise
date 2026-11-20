import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
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

describe('the header slot', () => {
  it('renders before the banner, above the score row, which keeps its floor', () => {
    const ui = createUiStore('dark');
    render(
      <TooltipProvider>
        <AppFrame
          ui={ui}
          header={<header>slim</header>}
          banner={<p>strip</p>}
          score={<p>score</p>}
        />
      </TooltipProvider>,
    );
    const header = screen.getByText('slim');
    expect(header.nextElementSibling).toBe(screen.getByText('strip'));
    expect(screen.getByRole('main', { name: 'Score' }).parentElement).toHaveClass('min-h-40');
  });
});

describe('the status slot', () => {
  it('is the last row, after the transport footer, which no longer holds the zoom readout', () => {
    const ui = createUiStore('dark');
    render(
      <TooltipProvider>
        <AppFrame ui={ui} score={<p>score</p>} transport={<p>controls</p>} status={<p>bar</p>} />
      </TooltipProvider>,
    );
    const footer = screen.getByRole('contentinfo', { name: 'Transport' });
    expect(footer.nextElementSibling).toBe(screen.getByText('bar'));
    expect(screen.getByText('bar').nextElementSibling).toBeNull();
    expect(footer).not.toHaveTextContent('%');
  });
});

describe('the bottom dock', () => {
  it('is a collapsed tab strip until opened, then shows the view, and the chevron collapses it', () => {
    const ui = renderFrame();
    const region = screen.getByRole('region', { name: 'Bottom panel' });
    expect(region).toContainElement(screen.getByRole('tablist', { name: 'Bottom panel views' }));
    expect(screen.queryByText('fret content')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize bottom panel' })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Expand bottom panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(ui.getState().bottomPanel.open).toBe(true);
    expect(screen.getByRole('tabpanel', { name: 'Fretboard' })).toHaveTextContent('fret content');
    expect(screen.getByRole('button', { name: 'Collapse bottom panel' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Collapse bottom panel' }));
    expect(ui.getState().bottomPanel.open).toBe(false);
    expect(screen.queryByText('fret content')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Fretboard' })).toBeInTheDocument();
  });

  it('keeps the collapse button, so focus stays on it', () => {
    renderFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Expand bottom panel' }));
    const collapse = screen.getByRole('button', { name: 'Collapse bottom panel' });
    collapse.focus();
    fireEvent.click(collapse);
    expect(screen.getByRole('button', { name: 'Expand bottom panel' })).toHaveFocus();
  });

  it('follows the tabs pattern: a roving tab stop, a linked panel, a tab that expands the dock', () => {
    const ui = renderFrame();
    const tab = screen.getByRole('tab', { name: 'Fretboard' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('tabindex', '0');
    expect(tab).not.toHaveAttribute('aria-controls');
    fireEvent.click(tab);
    expect(ui.getState().bottomPanel.open).toBe(true);
    const panel = screen.getByRole('tabpanel', { name: 'Fretboard' });
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent('fret content');
    expect(panel).toHaveClass('overflow-auto');
  });

  it('is reachable by keyboard: arrows, Home and End on the one tab keep it selected and the dock closed', () => {
    const ui = renderFrame();
    const tab = screen.getByRole('tab', { name: 'Fretboard' });
    tab.focus();
    for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) fireEvent.keyDown(tab, { key });
    expect(tab).toHaveFocus();
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(ui.getState().bottomPanel.open).toBe(false);
  });

  it('moves focus to the chevron when collapsing from inside the view or the resize handle', () => {
    renderFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Expand bottom panel' }));
    const tabpanel = screen.getByRole('tabpanel');
    const inner = document.createElement('button');
    tabpanel.append(inner);
    inner.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse bottom panel' }));
    expect(screen.getByRole('button', { name: 'Expand bottom panel' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Expand bottom panel' }));
    screen.getByRole('separator', { name: 'Resize bottom panel' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse bottom panel' }));
    expect(screen.getByRole('button', { name: 'Expand bottom panel' })).toHaveFocus();
  });

  it('shows no selected underline while collapsed', () => {
    const ui = renderFrame();
    const tab = screen.getByRole('tab', { name: 'Fretboard' });
    expect(tab).not.toHaveClass('border-primary');
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    expect(tab).toHaveClass('border-primary');
  });

  it('gives way before the transport is clipped when open, and the strip never shrinks', () => {
    const ui = renderFrame();
    const region = screen.getByRole('region', { name: 'Bottom panel' });
    // Jsdom has no layout; the classes and style carry the contract.
    expect(region).toHaveClass('shrink-0');
    expect(region.style.height).toBe('');
    expect(screen.getByRole('main', { name: 'Score' }).parentElement).toHaveClass('min-h-40');
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    expect(region).not.toHaveClass('shrink-0');
    expect(region).toHaveClass('min-h-0');
    expect(region).toHaveStyle({ height: `${String(BOTTOM_PANEL_HEIGHT.default)}px` });
  });

  it('resizes by a vertical pointer drag, committing the height when it ends', () => {
    const ui = renderFrame();
    act(() => {
      ui.getState().showBottomPanelView('fretboard');
    });
    HTMLElement.prototype.setPointerCapture = () => undefined;
    const handle = screen.getByRole('separator', { name: 'Resize bottom panel' });
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 450, pointerId: 1 });
    expect(ui.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.default + 50);
    expect(ui.getState().bottomPanelHeightCommitted).toBe(BOTTOM_PANEL_HEIGHT.default);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(ui.getState().bottomPanelHeightCommitted).toBe(BOTTOM_PANEL_HEIGHT.default + 50);
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
    for (let i = 0; i < 100; i++) fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(ui.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.max);
    for (let i = 0; i < 100; i++) fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(ui.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_HEIGHT.min);
  });
});

describe('the bottom panel state', () => {
  it('asks for one follow when the region opens or resizes, only while following', () => {
    const ui = createUiStore('dark');
    const before = ui.getState().follow.request;
    ui.getState().showBottomPanelView('fretboard');
    ui.getState().setBottomPanelHeight(300);
    expect(ui.getState().follow.request).toBe(before + 2);
    ui.getState().pauseFollow();
    ui.getState().setBottomPanelHeight(320);
    ui.getState().setBottomPanelOpen(false);
    expect(ui.getState().follow).toMatchObject({ on: false, request: before + 2 });
  });

  it('toggleBottomPanelView opens, then closes, and collapsing keeps the view', () => {
    const ui = createUiStore('dark');
    ui.getState().toggleBottomPanelView('fretboard');
    expect(ui.getState().bottomPanel).toEqual({ open: true, view: 'fretboard' });
    ui.getState().toggleBottomPanelView('fretboard');
    expect(ui.getState().bottomPanel).toEqual({ open: false, view: 'fretboard' });
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isTooltipEscape } from './tooltip-escape';
import {
  TOOLTIP_DELAY_MS,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

describe('tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>Hint</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    return screen.getByText('Trigger');
  }

  it('opens about half a second after the pointer arrives, not at once', () => {
    const trigger = setup();
    fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 100);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('opens a neighbour at once after one was open (the skip delay)', () => {
    render(
      <TooltipProvider>
        {['A', 'B'].map((name) => (
          <Tooltip key={name}>
            <TooltipTrigger>{name}</TooltipTrigger>
            <TooltipContent>{`Hint ${name}`}</TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>,
    );
    fireEvent.pointerMove(screen.getByText('A'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS + 100);
    });
    fireEvent.pointerOut(screen.getByText('A'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerMove(screen.getByText('B'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getAllByText('Hint B').length).toBeGreaterThan(0);
  });

  it('does not mark an Escape that an earlier listener already consumed', () => {
    const trigger = setup();
    fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS + 100);
    });
    const early = (event: Event) => {
      event.preventDefault();
    };
    window.addEventListener('keydown', early, true);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    window.removeEventListener('keydown', early, true);
    expect(isTooltipEscape(event)).toBe(false);
  });

  it('marks the Escape it takes, so the dispatcher can tell it from a popover', () => {
    const trigger = setup();
    fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS + 100);
    });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(isTooltipEscape(event)).toBe(true);
  });
});

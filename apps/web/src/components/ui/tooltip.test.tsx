import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isTooltipEscape } from './tooltip-escape';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

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
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('marks the Escape it takes, so the dispatcher can tell it from a popover', () => {
    const trigger = setup();
    fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(isTooltipEscape(event)).toBe(true);
  });
});

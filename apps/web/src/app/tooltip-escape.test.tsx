import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { installShortcutDispatcher } from './shortcut-dispatcher';

// Pins the Radix DOM `otherLayerOpen` reads: a real popover and a real tooltip, no hand-built markup.
describe('Escape over a real popover and tooltip', () => {
  it('goes to the popover first, then one more press leaves practice mode', async () => {
    const user = userEvent.setup();
    const services = createTestServices();
    const stop = installShortcutDispatcher(window, createAppRegistry(services), 'mac');
    try {
      services.ui.getState().enterPracticeMode('play');
      render(
        <TooltipProvider delayDuration={0}>
          <Popover>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent>Body</PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger>Other</TooltipTrigger>
            <TooltipContent>Hint</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );
      await user.click(screen.getByText('Open'));
      expect(await screen.findByText('Body')).toBeTruthy();
      await user.hover(screen.getByText('Other'));
      expect(await screen.findByRole('tooltip')).toBeTruthy();

      await user.keyboard('{Escape}');
      expect(services.ui.getState().practiceMode.on).toBe(true);
      await user.keyboard('{Escape}');
      await user.keyboard('{Escape}');
      expect(screen.queryByText('Body')).toBeNull();
      expect(services.ui.getState().practiceMode.on).toBe(false);
    } finally {
      stop();
    }
  });
});

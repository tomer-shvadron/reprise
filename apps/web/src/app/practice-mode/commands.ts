import type { Command } from '../command-registry';
import { loopBars } from '../palette/actions';
import type { AppServices } from '../services';
import type { BarRange } from '@/state/selection';

import { enterPracticeMode, leavePracticeMode, togglePracticeMode } from './practice-mode';

export type PracticeCommandId = 'view.practiceMode' | 'view.leavePracticeMode' | 'view.focusOnLoop';

type PracticeCommand = Command & { id: PracticeCommandId };

/**
 * The bars "Focus on loop" works on: a bar selection that is not already the loop (it becomes the
 * loop), otherwise the existing loop; `bars` is absent when the loop stays as it is.
 */
function focusTarget(services: AppServices): { bars: BarRange | undefined } | undefined {
  const { document, selection, playback } = services;
  if (!document.getState().score) return undefined;
  const loop = playback.getState().settings.loop;
  const bars = selection.getState().bars;
  const same = bars && loop && bars.startBar === loop.startBar && bars.endBar === loop.endBar;
  if (bars && !same) return { bars };
  return loop ? { bars: undefined } : undefined;
}

export function practiceCommands(services: AppServices): PracticeCommand[] {
  const { ui, document, playback } = services;
  const hasScore = () => document.getState().score !== undefined;
  return [
    {
      id: 'view.practiceMode',
      title: 'Toggle practice mode',
      // Guitar Pro 8's Full Screen key. On macOS F11 is Show Desktop unless it is turned off; the
      // header segment and the palette reach the mode, and the key can be rebound.
      shortcut: { key: 'F11' },
      enabled: hasScore,
      repeat: false,
      run: () => {
        togglePracticeMode(services);
      },
    },
    {
      id: 'view.leavePracticeMode',
      title: 'Leave practice mode',
      shortcut: { key: 'Escape' },
      inPalette: false,
      afterTooltipEscape: true,
      // Practice is never edit mode, so this Escape never competes with the editing one.
      enabled: () => ui.getState().practiceMode.on,
      run: () => {
        leavePracticeMode(services);
      },
    },
    {
      id: 'view.focusOnLoop',
      title: 'Focus on loop',
      enabled: () => {
        const bars = services.selection.getState().bars;
        return (
          hasScore() && (bars !== undefined || playback.getState().settings.loop !== undefined)
        );
      },
      run: () => {
        const target = focusTarget(services);
        if (!target) return;
        if (target.bars) {
          const { masterBars } = document.getState().score ?? { masterBars: [] };
          const start = masterBars.findIndex((bar) => bar.id === target.bars?.startBar);
          const end = masterBars.findIndex((bar) => bar.id === target.bars?.endBar);
          if (start < 0 || end < 0) return;
          loopBars(services, start, end, 'the selection');
          // A range the engine refused keeps the old loop, announces it, and the mode is not entered.
          const loop = playback.getState().settings.loop;
          if (loop?.startBar !== target.bars.startBar || loop.endBar !== target.bars.endBar) return;
        }
        enterPracticeMode(services);
      },
    },
  ];
}

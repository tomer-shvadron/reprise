import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

export type SoundsCommandId = 'sounds.show';

type SoundsCommand = Command & { id: SoundsCommandId };

export function soundsCommands(services: Pick<AppServices, 'ui'>): SoundsCommand[] {
  const { ui } = services;
  return [
    {
      id: 'sounds.show',
      title: 'Show sound manager',
      run: () => {
        ui.getState().setScreen('sounds');
      },
    },
  ];
}

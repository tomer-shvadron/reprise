import { CommandDialog } from '@/components/ui/command';
import { useStore } from 'zustand';

import type { UiStore } from '@/state/ui';

import type { CommandRegistry } from './command-registry';
import type { KeyboardPlatform } from './keyboard';
import { PaletteBody } from './palette/palette-body';
import type { AppServices } from './services';

interface CommandPaletteProps {
  registry: CommandRegistry;
  ui: UiStore;
  keyboard: KeyboardPlatform;
  services: AppServices;
}

/**
 * Everything that reads another store lives in `PaletteBody`, which Radix mounts only while the
 * dialog is open. A new `paletteRequest` remounts it, so asking for another mode starts over.
 */
export function CommandPalette({ registry, ui, keyboard, services }: CommandPaletteProps) {
  const open = useStore(ui, (state) => state.paletteOpen);
  const mode = useStore(ui, (state) => state.paletteMode);
  const request = useStore(ui, (state) => state.paletteRequest);
  const setOpen = useStore(ui, (state) => state.setPaletteOpen);
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <PaletteBody
        key={request}
        services={services}
        registry={registry}
        keyboard={keyboard}
        start={mode}
        close={() => {
          setOpen(false);
        }}
      />
    </CommandDialog>
  );
}

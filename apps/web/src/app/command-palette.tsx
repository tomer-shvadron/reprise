import { useStore } from 'zustand';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import type { UiStore } from '@/state/ui';

import { runCommand, type CommandRegistry } from './command-registry';
import { formatShortcut, type KeyboardPlatform } from './keyboard';

interface CommandPaletteProps {
  registry: CommandRegistry;
  ui: UiStore;
  keyboard: KeyboardPlatform;
}

export function CommandPalette({ registry, ui, keyboard }: CommandPaletteProps) {
  const open = useStore(ui, (state) => state.paletteOpen);
  const setOpen = useStore(ui, (state) => state.setPaletteOpen);
  const commands = registry.list().filter((command) => command.inPalette !== false);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>
          <CommandGroup heading="Commands">
            {commands.map((command) => (
              <CommandItem
                key={command.id}
                value={command.id}
                keywords={[command.title]}
                onSelect={() => {
                  setOpen(false);
                  runCommand(command);
                }}
              >
                {command.title}
                {command.shortcut && (
                  <CommandShortcut>{formatShortcut(command.shortcut, keyboard)}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

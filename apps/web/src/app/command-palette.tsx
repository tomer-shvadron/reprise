import { defaultFilter } from 'cmdk';
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
import { formatShortcut, shortcutOn, type KeyboardPlatform } from './keyboard';

interface CommandPaletteProps {
  registry: CommandRegistry;
  ui: UiStore;
  keyboard: KeyboardPlatform;
}

/**
 * cmdk's fuzzy score, except that a title the search is the start of comes first: typing "Bar
 * properties" must reach that command before any looser match. The title is the item's first keyword.
 */
function rank(value: string, search: string, keywords?: string[]): number {
  const title = keywords?.[0]?.toLowerCase() ?? '';
  const wanted = search.trim().toLowerCase();
  if (wanted !== '' && title.startsWith(wanted)) return 2;
  return defaultFilter(value, search, keywords);
}

export function CommandPalette({ registry, ui, keyboard }: CommandPaletteProps) {
  const open = useStore(ui, (state) => state.paletteOpen);
  const setOpen = useStore(ui, (state) => state.setPaletteOpen);
  const commands = registry.available().filter((command) => command.inPalette !== false);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command filter={rank}>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>
          <CommandGroup heading="Commands">
            {commands.map((command) => {
              const shortcut = registry.isShadowed(command)
                ? undefined
                : shortcutOn(command.shortcut, keyboard);
              return (
                <CommandItem
                  key={command.id}
                  value={command.id}
                  keywords={[command.searchTitle ?? command.title]}
                  onSelect={() => {
                    setOpen(false);
                    runCommand(command);
                  }}
                >
                  {command.title}
                  {shortcut && (
                    <CommandShortcut>{formatShortcut(shortcut, keyboard)}</CommandShortcut>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

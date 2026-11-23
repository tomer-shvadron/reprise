import { transportCommands } from '@/features/transport';
// The phase 3 features by their command files, for the same reason as the tracks below.
import { editorCommands } from '@/features/editor/commands';
import { onNotatedStaff } from '@/features/editor/standard-staff';
import { libraryCommands } from '@/features/library/commands';
import { soundsCommands } from '@/features/sounds/commands';
import { trainerCommands } from '@/features/trainer/commands';
// Not the feature's index: its components import the services context, which imports this file.
import { trackCommands } from '@/features/tracks/commands';
import { seekCommands } from '@/features/transport/seek-commands';

import { CommandRegistry } from './command-registry';
import { detectKeyboardPlatform, type KeyboardPlatform } from './keyboard';
import { createKeymapResolver } from './keymap';
import { appCommands } from './commands';
import { editCommands } from './edit-commands';
import { practiceCommands } from './practice-mode/commands';
import { selectionPillCommands } from './selection-pill/commands';
import type { AppServices } from './services';

/** Every command the app registers, in the order the palette and the shortcut table list them. */
export function createAppRegistry(
  services: AppServices,
  keyboard: KeyboardPlatform = detectKeyboardPlatform(),
): CommandRegistry {
  // The user's keys sit on the defaults here. The registry is built before the settings load, so
  // `register` sees defaults only; hydration then changes the overrides value and the resolver
  // recomputes, still conflict-free.
  const keymap = createKeymapResolver(services.settings, keyboard, () => registry);
  const registry = new CommandRegistry(
    (context) => {
      // Every context refines edit mode. The standard staff's letters stay out of a word field,
      // where they are text.
      if (!services.editing.getState().editing) return false;
      if (context === 'editing') return true;
      return (
        services.entry.getState().word === undefined &&
        onNotatedStaff(services.document.getState().score, services.selection.getState().cursor)
      );
    },
    (command) => keymap(command),
  );
  for (const command of [
    ...appCommands(services),
    ...practiceCommands(services),
    ...transportCommands(services),
    ...seekCommands(services),
    ...editCommands(services),
    ...trackCommands(services),
    ...libraryCommands(services),
    ...trainerCommands(services),
    ...editorCommands(services),
    ...soundsCommands(services),
    ...selectionPillCommands(),
  ]) {
    registry.register(command);
  }
  return registry;
}

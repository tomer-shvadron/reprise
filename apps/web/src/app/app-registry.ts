import { transportCommands } from '@/features/transport';
// The phase 3 features by their command files, for the same reason as the tracks below.
import { editorCommands } from '@/features/editor/commands';
import { libraryCommands } from '@/features/library/commands';
import { soundsCommands } from '@/features/sounds/commands';
import { trainerCommands } from '@/features/trainer/commands';
// Not the feature's index: its components import the services context, which imports this file.
import { trackCommands } from '@/features/tracks/commands';
import { seekCommands } from '@/features/transport/seek-commands';

import { CommandRegistry } from './command-registry';
import { appCommands } from './commands';
import { editCommands } from './edit-commands';
import type { AppServices } from './services';

/** Every command the app registers, in the order the palette and the shortcut table list them. */
export function createAppRegistry(services: AppServices): CommandRegistry {
  const registry = new CommandRegistry();
  for (const command of [
    ...appCommands(services),
    ...transportCommands(services),
    ...seekCommands(services),
    ...editCommands(services),
    ...trackCommands(services),
    ...libraryCommands(services),
    ...trainerCommands(services),
    ...editorCommands(services),
    ...soundsCommands(services),
  ]) {
    registry.register(command);
  }
  return registry;
}

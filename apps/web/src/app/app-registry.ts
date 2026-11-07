import { transportCommands } from '@/features/transport';
// Not the feature's index: its components import the services context, which imports this file.
import { trackCommands } from '@/features/tracks/commands';

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
    ...editCommands(services),
    ...trackCommands(services),
  ]) {
    registry.register(command);
  }
  return registry;
}

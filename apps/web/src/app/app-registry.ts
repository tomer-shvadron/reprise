import { transportCommands } from '@/features/transport';
import { seekCommands } from '@/features/transport/seek-commands';

import { CommandRegistry } from './command-registry';
import { appCommands } from './commands';
import type { AppServices } from './services';

/** Every command the app registers, in the order the palette and the shortcut table list them. */
export function createAppRegistry(services: AppServices): CommandRegistry {
  const registry = new CommandRegistry();
  for (const command of [...appCommands(services), ...transportCommands(services)]) {
    registry.register(command);
  }
  // Seeking and following (WP-053).
  for (const command of seekCommands(services)) registry.register(command);
  return registry;
}

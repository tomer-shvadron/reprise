import { runCommand, type CommandRegistry } from './command-registry';
import { matchesShortcut, type KeyboardPlatform } from './keyboard';

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Runs the registered command whose shortcut matches the event; returns whether one ran. */
export function dispatchShortcut(
  event: KeyboardEvent,
  registry: CommandRegistry,
  platform: KeyboardPlatform,
  onError: (error: unknown) => void = console.error,
): boolean {
  if (event.defaultPrevented || event.isComposing) return false;

  const command = registry.list().find(({ shortcut }) => {
    if (!shortcut) return false;
    // A bare key typed into a text field is text, not a shortcut.
    if (!shortcut.mod && isEditable(event.target)) return false;
    return matchesShortcut(event, shortcut, platform);
  });
  if (!command) return false;

  event.preventDefault();
  runCommand(command, onError);
  return true;
}

export function installShortcutDispatcher(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  registry: CommandRegistry,
  platform: KeyboardPlatform,
): () => void {
  const listener = (event: KeyboardEvent) => {
    dispatchShortcut(event, registry, platform);
  };
  target.addEventListener('keydown', listener);
  return () => {
    target.removeEventListener('keydown', listener);
  };
}

import { runCommand, type CommandRegistry } from './command-registry';
import { matchesShortcut, type KeyboardPlatform } from './keyboard';

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

// Sliders are left out on purpose: Space plays while one has focus.
const ACTIVATES_ON_SPACE = [
  'button',
  'a[href]',
  'summary',
  ...[
    'button',
    'switch',
    'checkbox',
    'radio',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'tab',
    'treeitem',
  ].map((role) => `[role="${role}"]`),
].join(', ');

/** Keys that move a caret, so a text field keeps them whatever the modifiers. */
const NAVIGATION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** A bare key the focused element handles itself: text in a field, Space or Enter on a control. */
function leavesKeyToTarget(event: KeyboardEvent): boolean {
  const { target } = event;
  if (isEditable(target)) return true;
  const activates = event.key === ' ' || event.key === 'Enter';
  return activates && target instanceof Element && target.closest(ACTIVATES_ON_SPACE) !== null;
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
    if (NAVIGATION_KEYS.has(event.key) && isEditable(event.target)) return false;
    if (!shortcut.mod && leavesKeyToTarget(event)) return false;
    return matchesShortcut(event, shortcut, platform);
  });
  if (!command) return false;

  // A held key is still swallowed, so a held Space does not scroll the page.
  event.preventDefault();
  if (event.repeat && command.repeat === false) return false;
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

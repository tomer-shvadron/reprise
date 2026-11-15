import { contextRank, runCommand, type CommandRegistry } from './command-registry';
import { matchesShortcut, type KeyboardPlatform } from './keyboard';
import { isEditable, isTextField } from './text-field';

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

/** The command that opens and closes the palette, the one shortcut an open dialog lets through. */
const PALETTE_TOGGLE_ID = 'app.commandPalette';

/**
 * Radix sets `role` and `data-state` on its dialogs but not `aria-modal`, so both forms count.
 * A Radix popover is also `role="dialog"` yet not modal: it sits in a popper wrapper, left out.
 */
const OPEN_MODAL = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"][aria-modal="true"]',
].join(', ');

/**
 * Whether a modal dialog is open anywhere in the document, not only around the focused element:
 * focus can drift to the body behind a dialog, and a shortcut must not edit the score from there.
 */
function modalDialogOpen(): boolean {
  return [...document.querySelectorAll(OPEN_MODAL)].some(
    (dialog) => dialog.closest('[data-radix-popper-content-wrapper]') === null,
  );
}

/** Keys that delete text, so a text field keeps them whatever the modifiers. */
const DELETE_KEYS = new Set(['Backspace', 'Delete']);

/** A bare key the focused element handles itself: text in a field, Space or Enter on a control. */
function leavesKeyToTarget(event: KeyboardEvent): boolean {
  const { target } = event;
  if (isEditable(target)) return true;
  const activates = event.key === ' ' || event.key === 'Enter';
  return activates && target instanceof Element && target.closest(ACTIVATES_ON_SPACE) !== null;
}

/**
 * Runs the registered command whose shortcut matches the event; returns whether one ran.
 *
 * What never runs a command (the one place these rules live; the keyboard-shortcuts reference
 * summarises them for users):
 * - Any shortcut while a modal dialog is open, except the palette toggle (Cmd/Ctrl+K). Escape and
 *   the rest stay with the dialog.
 * - A key that was already handled (`defaultPrevented`) or is part of IME composition.
 * - A bare key (no Cmd or Ctrl) typed in a text field, and Space or Enter on a focused control.
 * - Arrows, Home, End and Page keys in a text field, select, range or checkbox, whatever the
 *   modifiers.
 * - Backspace and Delete in a text field, whatever the modifiers: they edit its text.
 */
export function dispatchShortcut(
  event: KeyboardEvent,
  registry: CommandRegistry,
  platform: KeyboardPlatform,
  onError: (error: unknown) => void = console.error,
): boolean {
  if (event.defaultPrevented || event.isComposing) return false;

  const dialogOpen = modalDialogOpen();
  const matching = registry.available().filter(({ id, shortcut }) => {
    if (!shortcut) return false;
    if (dialogOpen && id !== PALETTE_TOGGLE_ID) return false;
    if (DELETE_KEYS.has(event.key) && isTextField(event.target)) return false;
    if (NAVIGATION_KEYS.has(event.key) && isEditable(event.target)) return false;
    if (!shortcut.mod && leavesKeyToTarget(event)) return false;
    return matchesShortcut(event, shortcut, platform);
  });
  // An active context's binding shadows the context-free one on the same key; between active
  // contexts, the earlier one in COMMAND_CONTEXTS wins.
  const command = matching.sort((a, b) => contextRank(a.context) - contextRank(b.context))[0];
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
